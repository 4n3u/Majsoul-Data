const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');

/**
 * Fetches data from a given URL, handling different response types.
 * @param {string} url The URL to fetch data from.
 * @param {string} responseType The expected response type (e.g., 'json', 'arraybuffer').
 * @returns {Promise<any|null>} A promise that resolves to the data, or null if an error occurs.
 */
async function fetchData(url, responseType = 'json') {
    try {
        console.log(`Fetching ${url}`);
        const response = await axios.get(url, { responseType });
        return response.data;
    } catch (error) {
        console.error(`Request failed for ${url}: ${error.message}`);
        return null;
    }
}

/**
 * Finds a resource in the manifest, downloads it, and saves it to a local file.
 * @param {string} baseUrl The base URL for game resources.
 * @param {object} resourceManifest The 'res' object from resversion.json.
 * @param {string} resourcePath The path of the resource to download (e.g., 'res/proto/liqi.json').
 */
async function downloadAndSaveResource(baseUrl, resourceManifest, resourcePath) {
    const resourceInfo = resourceManifest[resourcePath];
    if (!resourceInfo || !resourceInfo.prefix) {
        console.error(`Could not find prefix for ${resourcePath} in resversion.json`);
        return; // Skip this file
    }

    const prefix = resourceInfo.prefix;
    const finalUrl = `${baseUrl}${prefix}/${resourcePath}`;
    const outputFilename = path.basename(resourcePath);

    // Determine if the file is binary or text/json
    const responseType = outputFilename.endsWith('.lqbin') ? 'arraybuffer' : 'json';
    
    const data = await fetchData(finalUrl, responseType);

    if (data === null) {
        console.error(`Failed to fetch ${outputFilename}`);
        return;
    }

    try {
        // Prepare data for saving. JSON needs to be stringified.
        const dataToSave = (responseType === 'json' && typeof data === 'object')
            ? JSON.stringify(data, null, 2)
            : data;

        await fs.writeFile(outputFilename, dataToSave);
        console.log(`Successfully saved ${outputFilename}`);
    } catch (error) {
        console.error(`Failed to write file ${outputFilename}: ${error.message}`);
    }
}


/**
 * Main function to run the script.
 */
async function main() {
    const baseUrl = 'https://game.maj-soul.net/1/';
    const randomValue = Math.floor(Math.random() * 1e9) + Math.floor(Math.random() * 1e9);

    // 1. Fetch the version file
    const versionJson = await fetchData(`${baseUrl}version.json?randv=${randomValue}`);
    if (!versionJson || !versionJson.version) {
        console.error('Failed to fetch version.json or it is invalid.');
        process.exit(1);
    }
    const version = versionJson.version;
    console.log(`Found game version: ${version}`);
    
    // Save version info for GitHub Actions
    await fs.writeFile('version.txt', version);

    // 2. Fetch the resource manifest
    const resVersionJson = await fetchData(`${baseUrl}resversion${version}.json`);
    if (!resVersionJson || !resVersionJson.res) {
        console.error('Failed to fetch resversion.json or it is invalid.');
        process.exit(1);
    }
    const resourceManifest = resVersionJson.res;
    console.log('Resource manifest loaded.');

    // 3. Define the list of files to download
    const filesToDownload = [
        'res/proto/liqi.json',
        'res/config/lqc.lqbin',
        'res/proto/config.proto',
    ];

    // 4. Download all files in parallel
    console.log('\nStarting downloads...');
    const downloadPromises = filesToDownload.map(filePath => 
        downloadAndSaveResource(baseUrl, resourceManifest, filePath)
    );
    
    // Wait for all download and save operations to complete
    await Promise.all(downloadPromises);

    // 5. Convert liqi.json to liqi.proto and generate API documentation
    console.log('\nConverting liqi.json to liqi.proto...');
    const liqiJsonPath = path.join(__dirname, 'liqi.json');
    const liqiProtoPath = path.join(__dirname, 'liqi.proto');
    const docsDir = path.join(__dirname, 'docs');
    
    // Create docs directory
    const fsSync = require('fs');
    if (!fsSync.existsSync(docsDir)) {
        fsSync.mkdirSync(docsDir);
    }
    
    try {
        // Convert liqi.json to proto format
        const liqiJson = JSON.parse(await fs.readFile(liqiJsonPath, 'utf8'));
        let protoContent = 'syntax = "proto3";\n\n';
        protoContent += 'package lq;\n\n';
        
        // Convert each nested type to proto message
        function convertToProtoMessage(obj, name, indent = 0) {
            const spaces = '  '.repeat(indent);
            let result = `${spaces}message ${name} {\n`;
            let fieldIndex = 1;
            
            if (obj.fields) {
                for (const [fieldName, fieldDef] of Object.entries(obj.fields)) {
                    const repeated = fieldDef.rule === 'repeated' ? 'repeated ' : '';
                    const optional = fieldDef.rule === 'optional' ? 'optional ' : '';
                    const rule = repeated || optional;
                    
                    // Type conversion
                    let type = fieldDef.type;
                    if (type === 'int32' || type === 'uint32' || type === 'sint32' || 
                        type === 'fixed32' || type === 'sfixed32') {
                        type = type;
                    } else if (type === 'int64' || type === 'uint64' || type === 'sint64' || 
                               type === 'fixed64' || type === 'sfixed64') {
                        type = type;
                    } else if (type === 'double' || type === 'float') {
                        type = type;
                    } else if (type === 'bool') {
                        type = 'bool';
                    } else if (type === 'string') {
                        type = 'string';
                    } else if (type === 'bytes') {
                        type = 'bytes';
                    } else {
                        // Use custom type as-is
                        type = type;
                    }
                    
                    result += `${spaces}  ${rule}${type} ${fieldName} = ${fieldDef.id};\n`;
                }
            }
            
            // Handle nested types
            if (obj.nested) {
                for (const [nestedName, nestedObj] of Object.entries(obj.nested)) {
                    if (nestedObj.fields || nestedObj.nested) {
                        result += '\n' + convertToProtoMessage(nestedObj, nestedName, indent + 1);
                    } else if (nestedObj.values) {
                        // Handle enum types
                        result += `${spaces}  enum ${nestedName} {\n`;
                        for (const [enumName, enumValue] of Object.entries(obj.values)) {
                            result += `${spaces}    ${enumName} = ${enumValue};\n`;
                        }
                        result += `${spaces}  }\n\n`;
                    }
                }
            }
            
            result += `${spaces}}\n\n`;
            return result;
        }
        
        // Process nested objects from root
        if (liqiJson.nested && liqiJson.nested.lq && liqiJson.nested.lq.nested) {
            for (const [messageName, messageObj] of Object.entries(liqiJson.nested.lq.nested)) {
                if (messageObj.fields || messageObj.nested) {
                    protoContent += convertToProtoMessage(messageObj, messageName);
                } else if (messageObj.values) {
                    // Handle enum types
                    protoContent += `enum ${messageName} {\n`;
                    for (const [enumName, enumValue] of Object.entries(messageObj.values)) {
                        protoContent += `  ${enumName} = ${enumValue};\n`;
                    }
                    protoContent += '}\n\n';
                }
            }
        }
        
        // Save liqi.proto file
        await fs.writeFile(liqiProtoPath, protoContent);
        console.log('liqi.proto generated successfully.');
        
        // Generate HTML documentation with protoc-gen-doc
        console.log('Generating API documentation...');
        const { execSync } = require('child_process');
        
        try {
            // Use protoc-gen-doc to generate HTML documentation (Linux binary in GitHub Actions)
            const docCommand = `protoc --proto_path=. --plugin=protoc-gen-doc=./protoc-gen-doc --doc_out=docs --doc_opt=html,index.html:source_relative liqi.proto`;
            execSync(docCommand, { stdio: 'inherit' });
            console.log('API documentation generated successfully in docs/index.html');
        } catch (docError) {
            console.error('Failed to generate documentation:', docError.message);
        }
        
    } catch (protoError) {
        console.error('Failed to convert liqi.json to proto:', protoError);
    }

    // 6. Parse lqc.lqbin, config.proto and extract data (dynamic message definition)
    const dataDir = path.join(__dirname, 'data');
    if (!fsSync.existsSync(dataDir)) {
        fsSync.mkdirSync(dataDir);
    }

    // Parse config.proto and generate parsed.proto from schemas in lqc.lqbin
    const configProtoPath = path.join(__dirname, 'config.proto');
    const lqcBinPath = path.join(__dirname, 'lqc.lqbin');
    const parsedProtoPath = path.join(__dirname, 'parsed.proto');
    const protobuf = require('protobufjs');
    
    try {
        // 1. Load config.proto with protobufjs and parse lqc.lqbin with ConfigTables
        console.log('Loading config.proto with protobufjs...');
        const root = await protobuf.load(configProtoPath);
        const packageName = 'lq.config';
        const ConfigTables = root.lookupType(`${packageName}.ConfigTables`);
        const lqcBuffer = await fs.readFile(lqcBinPath);
        const configTable = ConfigTables.decode(lqcBuffer);
        
        console.log('Load tables from lqc.lqbin...');

        // 2. Generate parsed.proto from schemas
        console.log('Create parsed proto data...');
        let newProto = 'syntax = "proto3";\n\n';
        for (const schema of configTable.schemas) {
            for (const sheet of schema.sheets) {
                const classWords = `${schema.name}_${sheet.name}`.split('_');
                const className = classWords.map(name => name.charAt(0).toUpperCase() + name.slice(1)).join('');
                newProto += `message ${className} {\n`;
                for (const field of sheet.fields) {
                    const repeated = field.arrayLength > 0 ? 'repeated ' : '';
                    newProto += `  ${repeated}${field.pbType} ${field.fieldName} = ${field.pbIndex};\n`;
                }
                newProto += '}\n\n';
            }
        }
        
        console.log('Write parsed.proto...');
        await fs.writeFile(parsedProtoPath, newProto);
        
        // 3. Load parsed.proto with protobufjs and extract data
        console.log('Loading parsed.proto with protobufjs...');
        const parsedRoot = await protobuf.load(parsedProtoPath);
        
        console.log('Export data to json...');
        for (const data of configTable.datas) {
            if (!data.data || data.data.length === 0) {
                continue;
            }
            
            const classWords = `${data.table}_${data.sheet}`.split('_');
            const className = classWords.map(name => name.charAt(0).toUpperCase() + name.slice(1)).join('');
            const klass = parsedRoot.lookupType(className);
            
            if (!klass) {
                console.warn(`Type not found: ${className}`);
                continue;
            }
            
            const jsonData = [];
            for (const fieldMsg of data.data) {
                try {
                    const field = klass.decode(fieldMsg);
                    const row = {};
                    
                    // Extract values for all fields
                    for (const [fieldName, fieldDescriptor] of Object.entries(klass.fields)) {
                        if (field.hasOwnProperty(fieldName)) {
                            let value = field[fieldName];
                            // Convert repeated fields to arrays
                            if (fieldDescriptor.repeated && value && typeof value[Symbol.iterator] === 'function') {
                                value = Array.from(value);
                            }
                            row[fieldName] = value;
                        } else {
                            row[fieldName] = fieldDescriptor.repeated ? [] : null;
                        }
                    }
                    jsonData.push(row);
                } catch (decodeError) {
                    console.warn(`Failed to decode data for ${className}:`, decodeError.message);
                }
            }
            
            await fs.writeFile(path.join(dataDir, `${className}.json`), JSON.stringify(jsonData, null, 4));
            console.log(`Exported ${className}.json with ${jsonData.length} records`);
        }
        
        console.log('Export complete.');
    } catch (err) {
        console.error('Failed to parse lqc.lqbin or config.proto:', err);
    }

    console.log('\nAll tasks complete.');
}

// Run the main function.
main();