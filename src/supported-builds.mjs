import fs from 'node:fs';
import path from 'node:path';
export function supportedBuild(root){
 const version=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version;
 if(!['3.20.7','3.20.11','3.20.17','3.20.21','3.20.23','3.21.1','3.21.9','3.21.12','3.21.13'].includes(version))throw new Error('Unsupported Cursor version: '+version);
 const file=version==='3.20.7'?'supported-build.json':'supported-build-'+version+'.json';
 const build=JSON.parse(fs.readFileSync(new URL(file,import.meta.url),'utf8'));
 const product=JSON.parse(fs.readFileSync(path.join(root,'product.json'),'utf8'));
 if(product.commit!==build.commit)throw new Error('Unsupported Cursor commit.');
 return build;
}
