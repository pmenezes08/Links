"""
MuseTalk Integration for Talking Avatar Videos
Local, offline talking head generation
"""

import os
import sys
import subprocess
import logging
import yaml
import tempfile
from pathlib import Path

logger = logging.getLogger(__name__)

# MuseTalk installation path
MUSETALK_PATH = os.path.join(os.path.dirname(__file__), 'MuseTalk')
MUSETALK_MODELS_PATH = os.path.join(MUSETALK_PATH, 'models')

def check_musetalk_installed():
    """Check if MuseTalk is installed"""
    return os.path.exists(MUSETALK_PATH) and os.path.exists(os.path.join(MUSETALK_PATH, 'scripts', 'inference.py'))

def generate_talking_avatar(image_path: str, audio_path: str, output_path: str) -> str:
    """
    Generate talking avatar video using MuseTalk
    
    Args:
        image_path: Path to source image (any face)
        audio_path: Path to audio file
        output_path: Where to save output video
        
    Returns:
        Path to generated video
    """
    
    if not check_musetalk_installed():
        raise RuntimeError('MuseTalk is not installed. Clone repo and run download_weights.sh')
    
    try:
        logger.info(f'[MuseTalk] Generating video: {image_path} + {audio_path}')
        
        # Create temporary inference config
        with tempfile.NamedTemporaryFile(mode='w', suffix='.yaml', delete=False) as f:
            config = {
                'task1': {
                    'video_path': image_path,  # MuseTalk can take image or video
                    'audio_path': audio_path,
                    'result_name': os.path.basename(output_path),
                    'bbox_shift': 0
                }
            }
            yaml.dump(config, f)
            config_path = f.name
        
        # Get output directory
        output_dir = os.path.dirname(output_path)
        os.makedirs(output_dir, exist_ok=True)
        
        # Run MuseTalk inference script
        # Use sys.executable to ensure same Python interpreter as Flask app
        cmd = [
            sys.executable, os.path.join(MUSETALK_PATH, 'scripts', 'inference.py'),
            '--inference_config', config_path,
            '--output_dir', output_dir,
            '--use_float16',
            '--batch_size', '8'
        ]
        
        logger.info(f'[MuseTalk] Running: {" ".join(cmd)}')
        
        # Set PYTHONPATH to include MuseTalk directory and user site-packages
        env = os.environ.copy()
        pythonpath_parts = [MUSETALK_PATH]
        
        # Add user site-packages to ensure PyYAML and other deps are found
        import site
        user_site = site.getusersitepackages()
        if user_site and os.path.exists(user_site):
            pythonpath_parts.append(user_site)
        
        # Preserve existing PYTHONPATH
        if env.get('PYTHONPATH'):
            pythonpath_parts.append(env['PYTHONPATH'])
        
        env['PYTHONPATH'] = ':'.join(pythonpath_parts)
        
        result = subprocess.run(
            cmd,
            cwd=MUSETALK_PATH,
            env=env,
            capture_output=True,
            text=True,
            timeout=300
        )
        
        # Clean up temp config
        try:
            os.unlink(config_path)
        except:
            pass
        
        if result.returncode != 0:
            logger.error(f'[MuseTalk] STDERR: {result.stderr}')
            logger.error(f'[MuseTalk] STDOUT: {result.stdout}')
            raise RuntimeError(f'MuseTalk inference failed with code {result.returncode}')
        
        # Find generated video in output directory
        # MuseTalk saves as results/<task_name>/<result_name>
        expected_paths = [
            output_path,
            os.path.join(output_dir, 'results', 'task1', os.path.basename(output_path)),
            os.path.join(output_dir, os.path.basename(output_path))
        ]
        
        video_found = None
        for path in expected_paths:
            if os.path.exists(path):
                video_found = path
                break
        
        if not video_found:
            # List what was actually created
            logger.error(f'[MuseTalk] Expected video not found. Checked: {expected_paths}')
            logger.error(f'[MuseTalk] Output dir contents: {os.listdir(output_dir)}')
            raise RuntimeError('MuseTalk did not create output video')
        
        # Move to final location if needed
        if video_found != output_path:
            os.rename(video_found, output_path)
        
        output_size = os.path.getsize(output_path)
        logger.info(f'[MuseTalk] Video generated: {output_size} bytes at {output_path}')
        
        return output_path
        
    except Exception as e:
        logger.error(f'[MuseTalk] Generation failed: {e}')
        raise RuntimeError(f'MuseTalk generation failed: {e}')


def check_requirements():
    """Check if all requirements are met"""
    issues = []
    
    if not check_musetalk_installed():
        issues.append('MuseTalk not installed - clone repo and run download_weights.sh')
    
    try:
        import torch
        print(f'PyTorch version: {torch.__version__}')
        print(f'CUDA available: {torch.cuda.is_available()}')
    except ImportError:
        issues.append('PyTorch not installed - run: pip install torch')
    
    try:
        import cv2
    except ImportError:
        issues.append('OpenCV not installed - run: pip install opencv-python')
    
    try:
        import yaml
    except ImportError:
        issues.append('PyYAML not installed - run: pip install pyyaml')
    
    return issues


if __name__ == '__main__':
    # Test installation
    print('Checking MuseTalk installation...')
    issues = check_requirements()
    
    if issues:
        print('❌ Issues found:')
        for issue in issues:
            print(f'  - {issue}')
        sys.exit(1)
    else:
        print('✅ MuseTalk is ready!')
        sys.exit(0)
