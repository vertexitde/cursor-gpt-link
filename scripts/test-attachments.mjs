import assert from 'node:assert/strict';
import {png,pdf} from './attachment-fixtures.mjs';
import {config} from '../src/config.mjs';
for(const [name,part,prompt,expected] of [
 ['image',{type:'input_image',image_url:'data:image/png;base64,'+png().toString('base64')},'Name the main color of the attached image. Reply with the color only.',/blue/i],
 ['PDF',{type:'input_file',filename:'validation.pdf',file_data:'data:application/pdf;base64,'+pdf().toString('base64')},'Read the attached PDF. Reply with the validation word only.',/MARBLE7316/]]){
 const res=await fetch('http://127.0.0.1:'+config.port+'/v1/responses',{method:'POST',headers:{Authorization:'Bearer '+config.key,'Content-Type':'application/json'},
   body:JSON.stringify({model:'chatgpt-codex/'+(process.env.CHATGPT_TEST_MODEL||'gpt-5.6-luna'),input:[{role:'user',content:[part,{type:'input_text',text:prompt}]}],reasoning:{effort:'low'}}),signal:AbortSignal.timeout(200000)});
 const text=await res.text();assert.equal(res.status,200,text);
 const events=text.split('\n').filter(l=>l.startsWith('data: ')).map(l=>JSON.parse(l.slice(6)));
 const error=events.find(e=>e.type==='error'||e.type==='response.failed');assert.equal(error,undefined,error?.message);
 const output=events.filter(e=>e.type==='response.output_text.delta').map(e=>e.delta).join('');
 assert.match(output,expected);console.log('Live '+name+' contents understood: passed');
}
