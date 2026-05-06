import sys
sys.path.insert(0, 'C:/Users/kam_g/Documents/Micro-SaaS/GeoData_Hub/scripts')
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
import json

from clipper_service import ClipService

svc = ClipService()

with open('C:/Users/kam_g/Documents/Micro-SaaS/GeoData_Hub/test_aoi_bkk.json') as f:
    aoi_data = json.load(f)

print("AOI keys:", list(aoi_data.keys()))
print("AOI['aoi'] keys:", list(aoi_data['aoi'].keys()))
print("Calling clip_and_package...")
try:
    result = svc.clip_and_package(aoi_data['aoi'], ['waterways'], ['shp', 'geojson'])
    print(f"Success: {json.dumps(result, indent=2)}")
except Exception as e:
    import traceback
    traceback.print_exc()
