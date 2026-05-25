from pywebpush import generate_vapid_keypair
keys = generate_vapid_keypair()
with open('.env', 'a') as f:
    f.write(f"\nVAPID_PRIVATE_KEY={keys['private_key']}\n")
    f.write(f"VAPID_PUBLIC_KEY={keys['public_key']}\n")
