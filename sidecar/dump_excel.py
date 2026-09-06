import pandas as pd
import json

file_path = r'c:\Users\victus\OneDrive\Desktop\Use Case-2\Mesh_Healing.xlsx'
df = pd.read_excel(file_path, sheet_name=None)

output = {}
for sheet_name, sheet_df in df.items():
    output[sheet_name] = sheet_df.to_dict(orient='records')

with open('excel_dump.json', 'w') as f:
    json.dump(output, f, indent=4)
