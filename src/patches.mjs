import {supportedBuild} from './supported-builds.mjs';
import {buildPatches as previous} from './patches-3.20.7.mjs';
import {buildPatches as latest} from './patches-3.20.17.mjs';
import {buildPatches as current} from './patches-3.20.11.mjs';
export function buildPatches(options){
 const build=supportedBuild(options.root);
 return (build.version==='3.20.17'?latest:build.version==='3.20.11'?current:previous)(options);
}
