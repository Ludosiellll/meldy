import json
import base64
from py_vapid import Vapid

v = Vapid()
v.generate_keys()

# Export as base64url for VAPID_PRIVATE_KEY and VAPID_PUBLIC_KEY
priv_raw = v.private_key.private_numbers().private_value.to_bytes(32, 'big')
pub_raw = v.public_key.public_numbers().encode_point()

priv_b64 = base64.urlsafe_b64encode(priv_raw).decode('utf-8').rstrip('=')
pub_b64 = base64.urlsafe_b64encode(pub_raw).decode('utf-8').rstrip('=')

with open('.env', 'a') as f:
    f.write(f"\nVAPID_PRIVATE_KEY={priv_b64}\n")
    f.write(f"VAPID_PUBLIC_KEY={pub_b64}\n")

with open('../frontend/.env', 'a') as f:
    f.write(f"\nVITE_VAPID_PUBLIC_KEY={pub_b64}\n")

print("Keys generated successfully!")
