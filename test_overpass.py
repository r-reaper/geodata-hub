import requests
import sys

HEADERS = {
    "User-Agent": "ThaiGeoDataHub/1.0 (geospatial app; contact: hello@example.com)",
}

# Thailand full bbox - larger area
bbox = (97.3, 6.5, 105.7, 20.5)
bbox_str = f"{bbox[1]},{bbox[0]},{bbox[3]},{bbox[2]}"  # south,west,north,east

q = f'[out:json][timeout:60];way["highway"="primary"]({bbox_str});out body 3 geom;'
print(f"Query: {q}", file=sys.stderr)
r = requests.post("https://overpass-api.de/api/interpreter", data={"data": q}, headers=HEADERS, timeout=65)
print(f"Status: {r.status_code}")
data = r.json()
elements = data.get('elements', [])
print(f"Elements: {len(elements)}")
for e in elements[:3]:
    tags = e.get('tags', {})
    name = tags.get('name', tags.get('name:en', 'unnamed'))
    print(f"  - [{e['id']}] {name} (highway={tags.get('highway')})")
