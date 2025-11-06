#!/usr/bin/env python3
"""
MuseTalk API Server - Standalone service for GPU server
Provides REST API for talking avatar generation
"""

from flask import Flask, request, jsonify, send_file
import os
import sys
import logging
import tempfile
import yaml
import uuid
from pathlib import Path
import shutil

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 100 * 1024 * 1024  # 100MB max file size

# MuseTalk paths
MUSETALK_PATH = os.environ.get('MUSETALK_PATH', './MuseTalk')
OUTPUT_DIR = os.environ.get('OUTPUT_DIR', './outputs')
os.makedirs(OUTPUT_DIR, exist_ok=True)

# API authentication (simple bearer token)
API_SECRET = os.environ.get('MUSETALK_API_SECRET', 'your-secret-key-change-me')


def check_auth():
    """Check API authentication"""
    auth_header = request.headers.get('Authorization', '')
    if not auth_header.startswith('Bearer '):
        return False
    token = auth_header.replace('Bearer ', '')
    return token == API_SECRET


@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'musetalk_available': os.path.exists(os.path.join(MUSETALK_PATH, 'scripts', 'inference.py'))
    })


@app.route('/generate', methods=['POST'])
def generate():
    """
    Generate talking avatar video
    
    POST /generate
    Headers:
        Authorization: Bearer <API_SECRET>
    Files:
        image: Image file (JPG, PNG)
        audio: Audio file (WAV, MP3, WEBM)
    Returns:
        JSON with video_id on success
    """
    # Check authentication
    if not check_auth():
        return jsonify({'error': 'Unauthorized'}), 401
    
    try:
        # Get uploaded files
        if 'image' not in request.files or 'audio' not in request.files:
            return jsonify({'error': 'Missing image or audio file'}), 400
        
        image_file = request.files['image']
        audio_file = request.files['audio']
        
        # Generate unique ID for this job
        job_id = str(uuid.uuid4())
        job_dir = os.path.join(OUTPUT_DIR, job_id)
        os.makedirs(job_dir, exist_ok=True)
        
        # Save uploaded files
        image_path = os.path.join(job_dir, 'input_image.jpg')
        audio_path = os.path.join(job_dir, 'input_audio.wav')
        output_path = os.path.join(job_dir, 'output_video.mp4')
        
        image_file.save(image_path)
        audio_file.save(audio_path)
        
        logger.info(f'[Job {job_id}] Processing: {image_path} + {audio_path}')
        
        # Create MuseTalk config
        config = {
            'task1': {
                'video_path': image_path,
                'audio_path': audio_path,
                'bbox_shift': 0
            }
        }
        
        config_path = os.path.join(job_dir, 'config.yaml')
        with open(config_path, 'w') as f:
            yaml.dump(config, f)
        
        # Run MuseTalk inference
        import subprocess
        
        cmd = [
            'python3',
            os.path.join(MUSETALK_PATH, 'scripts', 'inference.py'),
            '--inference_config', config_path,
            '--result_dir', job_dir,
            '--use_float16',  # Use FP16 for faster inference on GPU
            '--batch_size', '4',  # Can use higher batch on GPU
            '--version', 'v1'
        ]
        
        logger.info(f'[Job {job_id}] Running: {" ".join(cmd)}')
        
        env = os.environ.copy()
        env['PYTHONPATH'] = MUSETALK_PATH + ':' + env.get('PYTHONPATH', '')
        
        result = subprocess.run(
            cmd,
            cwd=MUSETALK_PATH,
            env=env,
            capture_output=True,
            text=True,
            timeout=300  # 5 minutes (fast on GPU)
        )
        
        if result.returncode != 0:
            logger.error(f'[Job {job_id}] STDERR: {result.stderr}')
            logger.error(f'[Job {job_id}] STDOUT: {result.stdout}')
            return jsonify({
                'error': 'MuseTalk inference failed',
                'details': result.stderr
            }), 500
        
        # Find generated video
        # MuseTalk might save to results/task1/ subdirectory
        possible_paths = [
            output_path,
            os.path.join(job_dir, 'results', 'task1', 'output_video.mp4'),
            os.path.join(job_dir, 'output_video_musetalk.mp4')
        ]
        
        video_path = None
        for path in possible_paths:
            if os.path.exists(path):
                video_path = path
                break
        
        if not video_path:
            # List what was created
            logger.error(f'[Job {job_id}] Video not found. Directory contents:')
            for root, dirs, files in os.walk(job_dir):
                for f in files:
                    logger.error(f'  {os.path.join(root, f)}')
            return jsonify({'error': 'Video not generated'}), 500
        
        # Move to standard location if needed
        if video_path != output_path:
            shutil.move(video_path, output_path)
        
        video_size = os.path.getsize(output_path)
        logger.info(f'[Job {job_id}] Video generated: {video_size} bytes')
        
        return jsonify({
            'success': True,
            'job_id': job_id,
            'video_url': f'/download/{job_id}',
            'size_bytes': video_size
        })
        
    except subprocess.TimeoutExpired:
        logger.error(f'[Job {job_id}] Timeout')
        return jsonify({'error': 'Generation timeout'}), 500
    except Exception as e:
        logger.error(f'[Job {job_id}] Error: {e}', exc_info=True)
        return jsonify({'error': str(e)}), 500


@app.route('/download/<job_id>', methods=['GET'])
def download(job_id):
    """
    Download generated video
    
    GET /download/<job_id>
    Headers:
        Authorization: Bearer <API_SECRET>
    """
    # Check authentication
    if not check_auth():
        return jsonify({'error': 'Unauthorized'}), 401
    
    try:
        video_path = os.path.join(OUTPUT_DIR, job_id, 'output_video.mp4')
        if not os.path.exists(video_path):
            return jsonify({'error': 'Video not found'}), 404
        
        return send_file(video_path, mimetype='video/mp4', as_attachment=True)
        
    except Exception as e:
        logger.error(f'Error downloading video {job_id}: {e}')
        return jsonify({'error': str(e)}), 500


@app.route('/cleanup/<job_id>', methods=['DELETE'])
def cleanup(job_id):
    """
    Clean up job files to save disk space
    
    DELETE /cleanup/<job_id>
    Headers:
        Authorization: Bearer <API_SECRET>
    """
    # Check authentication
    if not check_auth():
        return jsonify({'error': 'Unauthorized'}), 401
    
    try:
        job_dir = os.path.join(OUTPUT_DIR, job_id)
        if os.path.exists(job_dir):
            shutil.rmtree(job_dir)
            logger.info(f'Cleaned up job {job_id}')
            return jsonify({'success': True})
        else:
            return jsonify({'error': 'Job not found'}), 404
    except Exception as e:
        logger.error(f'Error cleaning up {job_id}: {e}')
        return jsonify({'error': str(e)}), 500


if __name__ == '__main__':
    # Validate MuseTalk installation
    if not os.path.exists(os.path.join(MUSETALK_PATH, 'scripts', 'inference.py')):
        logger.error(f'MuseTalk not found at {MUSETALK_PATH}')
        logger.error('Please set MUSETALK_PATH environment variable or clone MuseTalk to ./MuseTalk')
        sys.exit(1)
    
    logger.info('MuseTalk API Server starting...')
    logger.info(f'MuseTalk path: {MUSETALK_PATH}')
    logger.info(f'Output directory: {OUTPUT_DIR}')
    logger.info(f'API Secret: {"SET" if API_SECRET != "your-secret-key-change-me" else "NOT SET - CHANGE THIS!"}')
    
    # Run server
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=False)
