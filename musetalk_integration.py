"""
MuseTalk Integration for Talking Avatar Videos
Local, offline talking head generation
"""

import os
import sys
import subprocess
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

# MuseTalk installation path
MUSETALK_PATH = os.path.join(os.path.dirname(__file__), 'MuseTalk')
MUSETALK_MODELS_PATH = os.path.join(MUSETALK_PATH, 'models')

def check_musetalk_installed():
    """Check if MuseTalk is installed"""
    return os.path.exists(MUSETALK_PATH) and os.path.exists(MUSETALK_MODELS_PATH)

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
        raise RuntimeError('MuseTalk is not installed. Run install_musetalk.sh first.')
    
    try:
        logger.info(f'[MuseTalk] Generating video: {image_path} + {audio_path}')
        
        # Add MuseTalk to Python path
        if MUSETALK_PATH not in sys.path:
            sys.path.insert(0, MUSETALK_PATH)
        
        # Import MuseTalk modules
        from musetalk.inference import inference
        
        # Run MuseTalk inference
        result = inference(
            source_image=image_path,
            audio_path=audio_path,
            output_path=output_path,
            batch_size=8,  # Adjust based on available memory
            fps=25,
            device='cpu'  # Use 'cuda' if GPU available
        )
        
        if not os.path.exists(output_path):
            raise RuntimeError('MuseTalk failed to generate video')
        
        output_size = os.path.getsize(output_path)
        logger.info(f'[MuseTalk] Video generated: {output_size} bytes')
        
        return output_path
        
    except Exception as e:
        logger.error(f'[MuseTalk] Generation failed: {e}')
        raise RuntimeError(f'MuseTalk generation failed: {e}')


def check_requirements():
    """Check if all requirements are met"""
    issues = []
    
    if not check_musetalk_installed():
        issues.append('MuseTalk not installed - run install_musetalk.sh')
    
    try:
        import torch
        logger.info(f'PyTorch version: {torch.__version__}')
        logger.info(f'CUDA available: {torch.cuda.is_available()}')
    except ImportError:
        issues.append('PyTorch not installed')
    
    try:
        import cv2
    except ImportError:
        issues.append('OpenCV not installed')
    
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
