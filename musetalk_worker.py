#!/usr/bin/env python3
"""
Standalone MuseTalk worker - processes talking avatar jobs independently
Run this separately from Flask: python3 musetalk_worker.py
"""

import os
import sys
import time
import logging
from datetime import datetime

# Add user site-packages for dependencies
try:
    home_dir = os.path.expanduser('~')
    user_site = os.path.join(home_dir, '.local', 'lib', 'python3.10', 'site-packages')
    if os.path.exists(user_site) and user_site not in sys.path:
        sys.path.insert(0, user_site)
except:
    pass

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Import after fixing path
from musetalk_integration import generate_talking_avatar
import pymysql
from pymysql.cursors import DictCursor

# MySQL config
MYSQL_HOST = os.getenv('MYSQL_HOST', 'puntz08.mysql.pythonanywhere-services.com')
MYSQL_USER = os.getenv('MYSQL_USER', 'puntz08')
MYSQL_PASSWORD = os.getenv('MYSQL_PASSWORD')
MYSQL_DB = os.getenv('MYSQL_DB', 'puntz08$C-Point')

IMAGINE_STATUS_PENDING = 'pending'
IMAGINE_STATUS_PROCESSING = 'processing'
IMAGINE_STATUS_COMPLETED = 'completed'
IMAGINE_STATUS_ERROR = 'error'

def get_db():
    return pymysql.connect(
        host=MYSQL_HOST,
        user=MYSQL_USER,
        password=MYSQL_PASSWORD,
        database=MYSQL_DB,
        cursorclass=DictCursor
    )

def fetch_pending_job():
    """Get next pending talking avatar job"""
    try:
        conn = get_db()
        c = conn.cursor()
        c.execute("""
            SELECT * FROM imagine_jobs 
            WHERE status=%s AND source_type='talking_avatar'
            ORDER BY created_at ASC LIMIT 1
        """, (IMAGINE_STATUS_PENDING,))
        job = c.fetchone()
        conn.close()
        return job
    except Exception as e:
        logger.error(f"Error fetching job: {e}")
        return None

def update_job(job_id, **fields):
    """Update job in database"""
    try:
        conn = get_db()
        c = conn.cursor()
        fields['updated_at'] = datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')
        
        set_parts = [f"{k}=%s" for k in fields.keys()]
        values = list(fields.values()) + [job_id]
        
        c.execute(f"UPDATE imagine_jobs SET {', '.join(set_parts)} WHERE id=%s", values)
        conn.commit()
        conn.close()
    except Exception as e:
        logger.error(f"Error updating job {job_id}: {e}")

def process_job(job):
    """Process a talking avatar job"""
    job_id = job['id']
    logger.info(f"Processing job {job_id}")
    
    try:
        update_job(job_id, status=IMAGINE_STATUS_PROCESSING, progress=10)
        
        # Get paths
        image_path = job['source_path']
        audio_path = job['audio_path']
        
        # Resolve full paths
        if not os.path.isabs(image_path):
            image_path = os.path.join('/home/puntz08/WorkoutX/Links/static', 
                                     image_path.replace('uploads/', '', 1))
        if not os.path.isabs(audio_path):
            audio_path = os.path.join('/home/puntz08/WorkoutX/Links/static',
                                     audio_path.replace('uploads/', '', 1))
        
        logger.info(f"Image: {image_path}")
        logger.info(f"Audio: {audio_path}")
        
        # Output path
        filename = f"avatar_{job_id}_{int(time.time())}.mp4"
        output_path = f"/home/puntz08/WorkoutX/Links/static/uploads/imagine/{filename}"
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        
        update_job(job_id, progress=30)
        
        # Generate video
        logger.info("Generating talking avatar...")
        generate_talking_avatar(image_path, audio_path, output_path)
        
        if not os.path.exists(output_path):
            raise RuntimeError("Video file not generated")
        
        video_size = os.path.getsize(output_path)
        logger.info(f"Video generated: {video_size} bytes")
        
        # Update as completed
        rel_path = f"uploads/imagine/{filename}"
        update_job(job_id, 
                  status=IMAGINE_STATUS_COMPLETED,
                  result_path=rel_path,
                  progress=100)
        
        # Update post
        target_id = job['target_id']
        if target_id:
            conn = get_db()
            c = conn.cursor()
            c.execute("UPDATE posts SET video_path=%s, audio_path=NULL WHERE id=%s", 
                     (rel_path, target_id))
            conn.commit()
            conn.close()
            logger.info(f"Post {target_id} updated")
        
        logger.info(f"Job {job_id} completed successfully!")
        
    except Exception as e:
        logger.error(f"Job {job_id} failed: {e}", exc_info=True)
        update_job(job_id, status=IMAGINE_STATUS_ERROR, error=str(e))

def main():
    """Main worker loop"""
    logger.info("MuseTalk worker started")
    logger.info("Polling for jobs every 5 seconds...")
    
    while True:
        try:
            job = fetch_pending_job()
            if job:
                process_job(job)
            else:
                time.sleep(5)  # Wait 5 seconds before checking again
        except KeyboardInterrupt:
            logger.info("Worker stopped by user")
            break
        except Exception as e:
            logger.error(f"Worker error: {e}", exc_info=True)
            time.sleep(10)

if __name__ == '__main__':
    main()
