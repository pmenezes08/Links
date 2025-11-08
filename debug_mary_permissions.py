#!/usr/bin/env python3
"""
Debug script to check Mary's permissions in ACME Corporation
Run this on your PythonAnywhere server to see what's happening
"""

import os
import sys

# Add the parent directory to the path
sys.path.insert(0, '/home/puntz08/dev/Links')

# Set environment variables
os.environ['USE_MYSQL'] = '1'
os.environ['MYSQL_HOST'] = 'puntz08.mysql.pythonanywhere-services.com'
os.environ['MYSQL_USER'] = 'puntz08'
os.environ['MYSQL_PASSWORD'] = os.environ.get('MYSQL_PASSWORD', '')
os.environ['MYSQL_DATABASE'] = 'puntz08$C-Point'

from bodybuilding_app import get_db_connection, get_sql_placeholder

def check_mary_permissions():
    print("=" * 60)
    print("DEBUGGING MARY'S PERMISSIONS")
    print("=" * 60)
    
    username = 'mary'
    
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            placeholder = get_sql_placeholder()
            
            # 1. Check if Mary exists
            print(f"\n1. Checking if user '{username}' exists...")
            c.execute(f"SELECT id, username, email FROM users WHERE username = {placeholder}", (username,))
            user = c.fetchone()
            if not user:
                print(f"❌ User '{username}' not found!")
                return
            
            user_id = user['id'] if hasattr(user, 'keys') else user[0]
            print(f"✅ User found: ID={user_id}")
            
            # 2. Find ACME Corporation (or any Business community)
            print(f"\n2. Looking for Business communities...")
            c.execute(f"SELECT id, name, type, creator_username FROM communities WHERE type = 'Business' OR type = 'business'")
            business_communities = c.fetchall()
            
            if not business_communities:
                print("❌ No Business communities found!")
                return
            
            print(f"✅ Found {len(business_communities)} Business communities:")
            for comm in business_communities:
                comm_id = comm['id'] if hasattr(comm, 'keys') else comm[0]
                comm_name = comm['name'] if hasattr(comm, 'keys') else comm[1]
                comm_type = comm['type'] if hasattr(comm, 'keys') else comm[2]
                comm_creator = comm['creator_username'] if hasattr(comm, 'keys') else comm[3]
                print(f"   - ID: {comm_id}, Name: {comm_name}, Type: {comm_type}, Creator: {comm_creator}")
            
            # 3. Check Mary's role in each Business community
            print(f"\n3. Checking {username}'s role in Business communities...")
            for comm in business_communities:
                comm_id = comm['id'] if hasattr(comm, 'keys') else comm[0]
                comm_name = comm['name'] if hasattr(comm, 'keys') else comm[1]
                comm_creator = comm['creator_username'] if hasattr(comm, 'keys') else comm[3]
                
                print(f"\n   Community: {comm_name} (ID: {comm_id})")
                
                # Check if owner
                if username == comm_creator:
                    print(f"   ✅ {username} is the OWNER of this community")
                else:
                    print(f"   ℹ️  Owner is: {comm_creator}")
                
                # Check membership
                c.execute(f"""
                    SELECT role, joined_at 
                    FROM user_communities 
                    WHERE user_id = {placeholder} AND community_id = {placeholder}
                """, (user_id, comm_id))
                membership = c.fetchone()
                
                if not membership:
                    print(f"   ❌ {username} is NOT a member of this community")
                else:
                    role = membership['role'] if hasattr(membership, 'keys') else membership[0]
                    joined = membership['joined_at'] if hasattr(membership, 'keys') else membership[1]
                    print(f"   ✅ Role: {role}")
                    print(f"   ✅ Joined: {joined}")
                    
                    if role == 'admin':
                        print(f"   🎉 {username} CAN create sub-communities here!")
                    elif role == 'member':
                        print(f"   ⚠️  {username} is only a member - cannot create sub-communities")
            
            # 4. Show the exact query that create_community uses
            print(f"\n4. Testing the actual permission check query...")
            # Assuming ACME Corporation is the first one
            if business_communities:
                test_comm_id = business_communities[0]['id'] if hasattr(business_communities[0], 'keys') else business_communities[0][0]
                test_comm_name = business_communities[0]['name'] if hasattr(business_communities[0], 'keys') else business_communities[0][1]
                
                print(f"\n   Testing against: {test_comm_name} (ID: {test_comm_id})")
                
                # Exact query from the code
                c.execute(f"""
                    SELECT role FROM user_communities
                    WHERE user_id = (SELECT id FROM users WHERE username = {placeholder})
                    AND community_id = {placeholder}
                """, (username, test_comm_id))
                
                result = c.fetchone()
                if result:
                    role = result['role'] if hasattr(result, 'keys') else result[0]
                    print(f"   ✅ Query returned role: {role}")
                    if role == 'admin':
                        print(f"   ✅ Permission check SHOULD PASS")
                    else:
                        print(f"   ❌ Permission check will FAIL (role is '{role}', not 'admin')")
                else:
                    print(f"   ❌ Query returned NO RESULTS")
                    print(f"   ❌ Permission check will FAIL")
            
    except Exception as e:
        print(f"\n❌ ERROR: {e}")
        import traceback
        traceback.print_exc()

if __name__ == '__main__':
    check_mary_permissions()
