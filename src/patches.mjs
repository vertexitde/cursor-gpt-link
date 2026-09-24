import {buildPatches as build3225} from './patches-3.22.5.mjs';
import {buildPatches as build32118} from './patches-3.21.18.mjs';
import {buildPatches as build32116} from './patches-3.21.16.mjs';
import {buildPatches as build32113} from './patches-3.21.13.mjs';
import {buildPatches as build32112} from './patches-3.21.12.mjs';
import {buildPatches as build3219} from './patches-3.21.9.mjs';
import {buildPatches as build3211} from './patches-3.21.1.mjs';
import {buildPatches as build32023} from './patches-3.20.23.mjs';
import {buildPatches as build32021} from './patches-3.20.21.mjs';
import {buildPatches as build32017} from './patches-3.20.17.mjs';
import {buildPatches as build32011} from './patches-3.20.11.mjs';
import {buildPatches as build3207} from './patches-3.20.7.mjs';
import {supportedBuild} from './supported-builds.mjs';
const builders={'3.22.5':build3225,'3.21.18':build32118,'3.21.16':build32116,'3.21.13':build32113,'3.21.12':build32112,'3.21.9':build3219,'3.21.1':build3211,'3.20.23':build32023,'3.20.21':build32021,'3.20.17':build32017,'3.20.11':build32011,'3.20.7':build3207};
export function buildPatches(options){
 const build=supportedBuild(options.root);
 const builder=builders[build.version];
 if(!builder)throw new Error('No patch definitions for Cursor '+build.version);
 return builder(options);
}
