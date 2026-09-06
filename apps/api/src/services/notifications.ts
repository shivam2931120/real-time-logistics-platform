import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import nodemailer from 'nodemailer';
import type { Order } from '@routepulse/shared';

let queue: Queue | undefined; let connection: Redis | undefined;
export function notificationMode(){ return process.env.QUEUE_MODE==='bullmq' && process.env.REDIS_URL ? 'bullmq' : 'inline-simulated'; }
export async function deliverEmail(payload:{to:string;template:string;trackingCode:string}) { if(!process.env.GOOGLE_SMTP_USER || !process.env.GOOGLE_SMTP_APP_PASSWORD) { console.info(JSON.stringify({event:'notification.simulated',...payload})); return {status:'simulated'}; } const transport=nodemailer.createTransport({host:process.env.SMTP_HOST||'smtp.gmail.com',port:Number(process.env.SMTP_PORT||465),secure:process.env.SMTP_SECURE!=='false',auth:{user:process.env.GOOGLE_SMTP_USER,pass:process.env.GOOGLE_SMTP_APP_PASSWORD}}); await transport.sendMail({from:process.env.EMAIL_FROM||process.env.GOOGLE_SMTP_USER,to:payload.to,subject:`RoutePulse update · ${payload.trackingCode}`,text:`Your delivery ${payload.trackingCode} has a ${payload.template.replaceAll('_',' ')} update.`}); await transport.close(); return {status:'sent'}; }
export async function notify(order: Order, template: string) {
  const payload={orderId:order.id,to:order.customerEmail,template,trackingCode:order.trackingCode};
  const redisUrl=process.env.REDIS_URL;
  if(notificationMode()!=='bullmq' || !redisUrl){ const result=await deliverEmail(payload); return {...result,mode:result.status==='sent'?'smtp':'simulated'}; }
  connection ??= new Redis(redisUrl,{maxRetriesPerRequest:null,lazyConnect:true});
  if(connection.status==='wait') await connection.connect();
  queue ??= new Queue('notifications',{connection});
  const job=await queue.add(template,payload,{attempts:4,backoff:{type:'exponential',delay:1000},removeOnComplete:1000,removeOnFail:1000});
  return {status:'queued',mode:'bullmq',jobId:job.id};
}
export async function closeNotifications(){await queue?.close();await connection?.quit();}
