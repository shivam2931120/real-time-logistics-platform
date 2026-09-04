import 'dotenv/config';
import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { deliverEmail } from '../services/notifications.js';
if(!process.env.REDIS_URL) throw new Error('REDIS_URL is required for the notification worker');
const connection=new Redis(process.env.REDIS_URL,{maxRetriesPerRequest:null});
const worker=new Worker('notifications',async job=>{await deliverEmail(job.data);console.info(JSON.stringify({event:'notification.delivered',jobId:job.id,...job.data}));return{deliveredAt:new Date().toISOString()}},{connection,concurrency:10});
worker.on('failed',(job,error)=>console.error(JSON.stringify({event:'notification.failed',jobId:job?.id,error:error.message})));
const stop=async()=>{await worker.close();await connection.quit();process.exit(0)};process.on('SIGINT',stop);process.on('SIGTERM',stop);
