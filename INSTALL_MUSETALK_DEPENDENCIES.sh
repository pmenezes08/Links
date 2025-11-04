#!/bin/bash
# Complete MuseTalk dependencies installation for PythonAnywhere
# Run: bash INSTALL_MUSETALK_DEPENDENCIES.sh

echo "Installing MuseTalk dependencies..."

# Install mmpose and mmcv (pose estimation)
pip3 install --user openmim
pip3 install --user mmengine
pip3 install --user "mmcv>=2.0.0"
pip3 install --user "mmpose>=1.0.0"

# Install other missing dependencies
pip3 install --user imageio imageio-ffmpeg
pip3 install --user ffmpeg-python
pip3 install --user av

echo "? All dependencies installed!"
echo ""
echo "Next steps:"
echo "1. Reload your Flask app"
echo "2. Test talking avatar generation"
