"""
MuseTalk Integration for Talking Avatar Videos
Calls remote GPU server API for fast generation
"""

import os
import logging
import requests
from pathlib import Path

logger = logging.getLogger(__name__)

# MuseTalk API configuration (set in .env file)
MUSETALK_API_URL = os.environ.get('MUSETALK_API_URL', '')
MUSETALK_API_SECRET = os.environ.get('MUSETALK_API_SECRET', '')

# Fallback to local if no API configured
LOCAL_FALLBACK = True  # Set to False to fail if API not configured


def check_api_configured():
    """Check if MuseTalk API is configured"""
    return bool(MUSETALK_API_URL and MUSETALK_API_SECRET)


def check_api_health():
    """Check if MuseTalk API server is accessible"""
    if not check_api_configured():
        return False, 'API not configured'
    
    try:
        response = requests.get(
            f'{MUSETALK_API_URL.rstrip("/")}/health',
            timeout=5
        )
        if response.status_code == 200:
            data = response.json()
            if data.get('musetalk_available'):
                return True, 'API healthy'
            else:
                return False, 'MuseTalk not available on server'
        else:
            return False, f'API returned {response.status_code}'
    except Exception as e:
        return False, f'Connection failed: {e}'


def generate_talking_avatar(image_path: str, audio_path: str, output_path: str) -> str:
    """
    Generate talking avatar video using MuseTalk API
    
    Args:
        image_path: Path to source image (any face)
        audio_path: Path to audio file
        output_path: Where to save output video
        
    Returns:
        Path to generated video
    """
    
    # Check API configuration
    if not check_api_configured():
        error_msg = 'MuseTalk API not configured. Set MUSETALK_API_URL and MUSETALK_API_SECRET in .env'
        logger.error(f'[MuseTalk] {error_msg}')
        
        if LOCAL_FALLBACK:
            # Try local fallback
            logger.info('[MuseTalk] Attempting local fallback...')
            return _generate_local(image_path, audio_path, output_path)
        else:
            raise RuntimeError(error_msg)
    
    try:
        logger.info(f'[MuseTalk API] Generating video: {image_path} + {audio_path}')
        logger.info(f'[MuseTalk API] Using server: {MUSETALK_API_URL}')
        
        # Prepare files for upload
        with open(image_path, 'rb') as img, open(audio_path, 'rb') as aud:
            files = {
                'image': (os.path.basename(image_path), img, 'image/jpeg'),
                'audio': (os.path.basename(audio_path), aud, 'audio/wav')
            }
            
            headers = {
                'Authorization': f'Bearer {MUSETALK_API_SECRET}'
            }
            
            # Send generation request
            logger.info('[MuseTalk API] Uploading files and requesting generation...')
            response = requests.post(
                f'{MUSETALK_API_URL.rstrip("/")}/generate',
                headers=headers,
                files=files,
                timeout=300  # 5 minutes (fast on GPU)
            )
        
        if response.status_code != 200:
            error_data = response.json() if response.headers.get('content-type') == 'application/json' else {'error': response.text}
            logger.error(f'[MuseTalk API] Generation failed: {error_data}')
            raise RuntimeError(f'API returned {response.status_code}: {error_data.get("error", "Unknown error")}')
        
        result = response.json()
        if not result.get('success'):
            raise RuntimeError(f'API generation failed: {result.get("error", "Unknown error")}')
        
        job_id = result['job_id']
        video_url = result['video_url']
        logger.info(f'[MuseTalk API] Video generated! Job ID: {job_id}')
        
        # Download the generated video
        logger.info(f'[MuseTalk API] Downloading video from {video_url}...')
        download_response = requests.get(
            f'{MUSETALK_API_URL.rstrip("/")}{video_url}',
            headers=headers,
            stream=True,
            timeout=60
        )
        
        if download_response.status_code != 200:
            raise RuntimeError(f'Failed to download video: {download_response.status_code}')
        
        # Save to output path
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        with open(output_path, 'wb') as f:
            for chunk in download_response.iter_content(chunk_size=8192):
                f.write(chunk)
        
        output_size = os.path.getsize(output_path)
        logger.info(f'[MuseTalk API] Video saved: {output_size} bytes at {output_path}')
        
        # Clean up remote job (optional, saves disk space on GPU server)
        try:
            requests.delete(
                f'{MUSETALK_API_URL.rstrip("/")}/cleanup/{job_id}',
                headers=headers,
                timeout=5
            )
            logger.info(f'[MuseTalk API] Cleaned up job {job_id}')
        except Exception as e:
            logger.warning(f'[MuseTalk API] Failed to cleanup job: {e}')
        
        return output_path
        
    except requests.exceptions.Timeout:
        logger.error('[MuseTalk API] Request timeout')
        if LOCAL_FALLBACK:
            logger.info('[MuseTalk API] Timeout - attempting local fallback...')
            return _generate_local(image_path, audio_path, output_path)
        raise RuntimeError('MuseTalk API timeout')
        
    except requests.exceptions.ConnectionError as e:
        logger.error(f'[MuseTalk API] Connection error: {e}')
        if LOCAL_FALLBACK:
            logger.info('[MuseTalk API] Connection failed - attempting local fallback...')
            return _generate_local(image_path, audio_path, output_path)
        raise RuntimeError(f'MuseTalk API connection failed: {e}')
        
    except Exception as e:
        logger.error(f'[MuseTalk API] Generation failed: {e}')
        raise RuntimeError(f'MuseTalk API generation failed: {e}')


def _generate_local(image_path: str, audio_path: str, output_path: str) -> str:
    """
    Local fallback - runs MuseTalk locally (NOT RECOMMENDED on CPU server)
    This will likely fail due to cgroup limits
    """
    logger.warning('[MuseTalk Local] Running local fallback - this may fail due to server limits!')
    
    # Import local implementation
    try:
        import subprocess
        import tempfile
        import yaml
        
        MUSETALK_PATH = os.path.join(os.path.dirname(__file__), 'MuseTalk')
        
        if not os.path.exists(os.path.join(MUSETALK_PATH, 'scripts', 'inference.py')):
            raise RuntimeError('MuseTalk not installed locally')
        
        # Create config
        with tempfile.NamedTemporaryFile(mode='w', suffix='.yaml', delete=False) as f:
            config = {
                'task1': {
                    'video_path': image_path,
                    'audio_path': audio_path,
                    'bbox_shift': 0
                }
            }
            yaml.dump(config, f)
            config_path = f.name
        
        output_dir = os.path.dirname(output_path)
        os.makedirs(output_dir, exist_ok=True)
        
        # Run with minimal resources
        cmd = [
            'nice', '-n', '19',
            'python3',
            os.path.join(MUSETALK_PATH, 'scripts', 'inference.py'),
            '--inference_config', config_path,
            '--result_dir', output_dir,
            '--use_float16',
            '--batch_size', '1',
            '--version', 'v1'
        ]
        
        result = subprocess.run(cmd, cwd=MUSETALK_PATH, capture_output=True, text=True, timeout=600)
        
        try:
            os.unlink(config_path)
        except:
            pass
        
        if result.returncode != 0:
            raise RuntimeError(f'Local inference failed with code {result.returncode}')
        
        if os.path.exists(output_path):
            return output_path
        else:
            raise RuntimeError('Local inference did not produce video')
            
    except Exception as e:
        logger.error(f'[MuseTalk Local] Failed: {e}')
        raise RuntimeError(f'Local fallback failed: {e}')


if __name__ == '__main__':
    # Test API connection
    print('Checking MuseTalk API...')
    
    if not check_api_configured():
        print('❌ MuseTalk API not configured')
        print('   Set MUSETALK_API_URL and MUSETALK_API_SECRET in .env file')
    else:
        print(f'API URL: {MUSETALK_API_URL}')
        healthy, message = check_api_health()
        if healthy:
            print(f'✅ {message}')
        else:
            print(f'❌ {message}')
