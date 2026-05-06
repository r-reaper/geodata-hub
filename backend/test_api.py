import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
from main import app
from fastapi.testclient import TestClient
client = TestClient(app)

tests = [
    ('GET', '/health'),
    ('GET', '/search-location?q=bangkok'),
    ('GET', '/search-location?q=chiang'),
    ('GET', '/layers'),
    ('GET', '/payments/prices'),
    ('GET', '/payments/credits/test-user-123'),
]

for method, url in tests:
    try:
        if method == 'GET':
            r = client.get(url)
        print(f'[{method}] {url} -> {r.status_code}')
        if r.status_code != 200:
            print(f'  ERROR: {r.text[:150]}')
    except Exception as e:
        print(f'[{method}] {url} -> EXCEPTION: {e}')