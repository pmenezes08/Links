import sqlite3

# Connect to the database
conn = sqlite3.connect('users.db')
c = conn.cursor()

# Insert premium user
email = 'test@example.com'  # Email as primary key
password = '12345'
subscription = 'premium'

try:
    c.execute("INSERT INTO users (email, password, subscription) VALUES (?, ?, ?)",
              (email, password, subscription))
    conn.commit()
    print(f"User with email '{email}' added as Premium successfully!")
except sqlite3.IntegrityError:
    print(f"User with email '{email}' already exists!")
finally:
    conn.close()