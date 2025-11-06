"""
MuseTalk Integration for Talking Avatar Videos
Local, offline talking head generation
"""

import os
import sys
import subprocess
import logging
import tempfile
from pathlib import Path

# Fix for uWSGI: Add user site-packages to sys.path so yaml can be imported
home_dir = os.path.expanduser('~')
user_site_packages = os.path.join(home_dir, '.local', 'lib', 'python3.10', 'site-packages')
if os.path.exists(user_site_packages) and user_site_packages not in sys.path:
    sys.path.insert(0, user_site_packages)

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
        # Import yaml here to avoid import errors at module load time
        try:
            import yaml
        except ImportError:
            raise RuntimeError('PyYAML not available. Install with: pip3 install --user PyYAML')
        
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
        
        # Run MuseTalk inference script using ~/.local/bin/python3 which has PyYAML
        python_exec = os.path.expanduser('~/.local/bin/python3')
        if not os.path.exists(python_exec):
            python_exec = 'python3'
            logger.warning(f'[MuseTalk] ~/.local/bin/python3 not found, using system python3')
        else:
            logger.info(f'[MuseTalk] Using Python: {python_exec}')
        
        cmd = [
            python_exec,
            os.path.join(MUSETALK_PATH, 'scripts', 'inference.py'),
            '--inference_config', config_path,
            '--result_dir', output_dir,  # Changed from --output_dir to --result_dir
            '--use_float16',  # Use half precision to save memory
            '--batch_size', str(1),  # Reduced from 8 to 1 to use less memory
            '--version', 'v1'  # Force v1 to avoid v15 config issues
        ]
        
        logger.info(f'[MuseTalk] Running: {" ".join(cmd)}')
        
        # Set environment - minimal changes to avoid breaking things
        env = os.environ.copy()
        env['PYTHONPATH'] = MUSETALK_PATH + ':' + env.get('PYTHONPATH', '')
        
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
        import yaml  # Local import to avoid module-level errors
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
