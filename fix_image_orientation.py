#!/usr/bin/env python3
"""
Script to fix EXIF orientation on existing images.
This rotates images based on their EXIF metadata so they display correctly on iOS.

Usage:
    python fix_image_orientation.py --dry-run    # Preview what will be fixed
    python fix_image_orientation.py              # Actually fix images
"""

import os
import sys
import argparse
from pathlib import Path

def fix_orientation(dry_run=False, folders=None):
    """Fix EXIF orientation on existing images."""
    
    try:
        from PIL import Image, ImageOps
        print("✓ PIL/Pillow is available")
    except ImportError:
        print("ERROR: Pillow not installed. Run: pip install Pillow")
        return
    
    # Find uploads directory
    base_dir = os.path.dirname(os.path.abspath(__file__))
    uploads_dirs = [
        os.path.join(base_dir, 'static', 'uploads'),
        os.path.join(base_dir, 'uploads'),
    ]
    
    # Default folders to scan
    if folders is None:
        folders = [
            'message_photos',
            'community_stories',
            'community_backgrounds',
            'profile_pictures',
            '',  # Root uploads folder
        ]
    
    # Image extensions to process
    image_extensions = {'.jpg', '.jpeg', '.png', '.webp'}
    
    total_files = 0
    fixed_files = 0
    skipped_files = 0
    failed_files = 0
    
    print(f"\n{'DRY RUN - ' if dry_run else ''}Scanning for images to fix...\n")
    
    for uploads_dir in uploads_dirs:
        if not os.path.exists(uploads_dir):
            continue
            
        print(f"Scanning: {uploads_dir}")
        
        for folder in folders:
            folder_path = os.path.join(uploads_dir, folder) if folder else uploads_dir
            if not os.path.exists(folder_path):
                continue
            
            # Don't recurse into subfolders if we're at root
            if folder == '':
                files_to_check = [f for f in os.listdir(folder_path) if os.path.isfile(os.path.join(folder_path, f))]
                folder_display = "(root)"
            else:
                files_to_check = []
                for root, dirs, files in os.walk(folder_path):
                    for f in files:
                        rel_path = os.path.relpath(os.path.join(root, f), folder_path)
                        files_to_check.append(rel_path)
                folder_display = folder
            
            if not files_to_check:
                continue
                
            print(f"\n  📁 {folder_display}/")
            
            for filename in files_to_check:
                file_path = os.path.join(folder_path, filename) if folder else os.path.join(uploads_dir, filename)
                
                # Skip non-image files
                ext = os.path.splitext(filename)[1].lower()
                if ext not in image_extensions:
                    continue
                
                # Skip hidden files
                if os.path.basename(filename).startswith('.'):
                    continue
                
                total_files += 1
                
                try:
                    with Image.open(file_path) as img:
                        # Check if image has EXIF orientation
                        exif = img.getexif()
                        orientation = exif.get(274)  # 274 is the EXIF orientation tag
                        
                        if orientation and orientation != 1:
                            # Image needs rotation
                            if dry_run:
                                print(f"    Would fix: {filename} (orientation={orientation})")
                                fixed_files += 1
                            else:
                                # Apply EXIF transpose
                                fixed_img = ImageOps.exif_transpose(img)
                                
                                # Save back
                                if ext in ('.jpg', '.jpeg'):
                                    if fixed_img.mode not in ('RGB', 'L'):
                                        fixed_img = fixed_img.convert('RGB')
                                    fixed_img.save(file_path, format='JPEG', quality=90, optimize=True)
                                elif ext == '.png':
                                    fixed_img.save(file_path, format='PNG', optimize=True)
                                elif ext == '.webp':
                                    fixed_img.save(file_path, format='WEBP', quality=90)
                                
                                print(f"    ✓ Fixed: {filename} (was orientation={orientation})")
                                fixed_files += 1
                        else:
                            skipped_files += 1
                            
                except Exception as e:
                    print(f"    ✗ Error: {filename} - {e}")
                    failed_files += 1
    
    print("\n" + "=" * 50)
    print("SUMMARY")
    print("=" * 50)
    print(f"Total images scanned: {total_files}")
    if dry_run:
        print(f"Would fix: {fixed_files} images")
    else:
        print(f"Fixed: {fixed_files} images")
    print(f"Already correct: {skipped_files} images")
    print(f"Errors: {failed_files} images")
    
    if fixed_files > 0 and not dry_run:
        print("\n✓ Images have been fixed! They should now display correctly on iOS.")
        print("\nNote: If images are cached in R2/CDN, you may need to re-upload them")
        print("or wait for the cache to expire.")


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Fix EXIF orientation on existing images')
    parser.add_argument('--dry-run', action='store_true', help='Preview without fixing')
    parser.add_argument('--folders', nargs='+', help='Specific folders to scan')
    args = parser.parse_args()
    
    fix_orientation(dry_run=args.dry_run, folders=args.folders)
