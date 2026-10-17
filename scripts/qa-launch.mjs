import {chromium} from 'playwright';
/** Только изолированный CI. Аппаратный WebGPU пользователя этой проверкой не имитируется. */
export async function launchQA(){return chromium.launch({channel:'chrome',headless:false,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});}
