from pathlib import Path
import subprocess
import json
from google.protobuf.descriptor import FieldDescriptor
import requests

def main():
    URL = "https://game.maj-soul.com/1"
    live_version_req = requests.get(f"{URL}/version.json" )
    live_version = live_version_req.json()
    
    local_version_path = Path("version.json")
    with open(local_version_path, "r", encoding="utf-8") as f:
        local_version = json.load(f)
    if local_version == live_version:
        print("No update")
        exit(0)
    else:
        print(f"New Live version: {live_version}")
        with open(local_version_path, "w", encoding="utf-8") as f:
            json.dump(live_version, f, ensure_ascii=False)
            print("Update README.md...")
            with open("README.md", "w", encoding="utf-8") as f:
                f.write(f"# Majsoul Data\n\nCurrent version: {live_version['version']}")
            
    live_version = live_version["version"]
    resversion_URL = f"{URL}/resversion{live_version}.json"
    resversion_req = requests.get(resversion_URL)
    resversion_req = resversion_req.json()
    
    config_proto_info = None
    lqc_info = None
    
    for file_path, info in resversion_req["res"].items():
        if file_path.endswith("config.proto"):
            config_proto_info = info
        elif file_path.endswith("lqc.lqbin"):
            lqc_info = info
            
    if not config_proto_info or not lqc_info:
        print(f"config.proto or lqc.lqbin not found")
        exit(1)
        
    config_proto_url = f"{URL}/{config_proto_info['prefix']}/res/proto/config.proto"
    lqc_url = f"{URL}/{lqc_info['prefix']}/res/config/lqc.lqbin"
    
    print("Download config.proto...")
    config_proto_req = requests.get(config_proto_url)
    with open("config.proto", "wb") as f:
        f.write(config_proto_req.content)
        
    print("Download lqc.lqbin...")
    lqc_req = requests.get(lqc_url)
    with open("lqc.lqbin", "wb") as f:
        f.write(lqc_req.content)

    subprocess.run(["protoc", "--python_out=.", "config.proto"])

    print("Load config_pb2.py...")
    import_path = Path("config_pb2.py")
    with open(import_path, "r", encoding="utf-8") as config_pb2_file:
        config_pb2_code = config_pb2_file.read()
        exec(config_pb2_code, globals())

    print("Load tables from lqc.lqbin...")
    config_table = ConfigTables()
    lqc_path = Path("lqc.lqbin")
    with open(lqc_path, "rb") as lqc:
        config_table.ParseFromString(lqc.read())

    print("Create parsed proto data...")

    new_proto = 'syntax = "proto3";\n\n'

    for schema in config_table.schemas:
        for parsed in schema.sheets:
            class_words = f"{schema.name}_{parsed.name}".split("_")
            class_name = "".join(name.capitalize() for name in class_words)
            new_proto += f"message {class_name} {{\n"
            for field in parsed.fields:
                new_proto += f'  {"repeated" if field.array_length > 0 else ""} {field.pb_type} {field.field_name} = {field.pb_index};\n'
            new_proto += "}\n\n"

    print("Write parsed.proto...")
    parsed_proto_path = Path("parsed.proto")
    with open(parsed_proto_path, "w", encoding="utf-8") as parsed:
        parsed.write(new_proto)

    print("Generate complete")
    
    print("Generate parsed_pb2.py...")
    subprocess.run(["protoc", "--python_out=.", "parsed.proto"])
    
    print("Load parsed_pb2.py...")
    import_parsed_path = Path("parsed_pb2.py")
    with open(import_parsed_path, "r", encoding="utf-8") as parsed_pb2_file:
        parsed_pb2_code = parsed_pb2_file.read()
        exec(parsed_pb2_code, globals())

    output_path = Path("data")
    output_path.mkdir(parents=True, exist_ok=True)

    print("Export data to json...")
    for data in config_table.datas:
        class_words = f"{data.table}_{data.sheet}".split("_")
        class_name = "".join(name.capitalize() for name in class_words)
        klass = globals()[class_name]

        with open(
            output_path / f"{class_name}.json", "w", encoding="utf-8"
        ) as jsonfile:
            json_data = []

            if not hasattr(data, "data"):
                continue

            for field_msg in data.data:
                field = klass()
                field.ParseFromString(field_msg)
                row = {}
                for descriptor_field in klass().DESCRIPTOR.fields:
                    if hasattr(field, descriptor_field.name):
                        value = getattr(field, descriptor_field.name)
                        if descriptor_field.label == FieldDescriptor.LABEL_REPEATED:
                            value = list(value)
                        row[descriptor_field.name] = value
                    else:
                        row[descriptor_field.name] = None
                json_data.append(row)

            json.dump(json_data, jsonfile, ensure_ascii=False, indent=4)
    print("Export complete")

if __name__ == "__main__":
    main()