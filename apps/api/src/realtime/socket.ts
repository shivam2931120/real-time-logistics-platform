import type { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { verifyToken } from '@clerk/backend';
import { drivers, orders, users } from '../domain/store.js';
import { persistDriver } from '../db/persistence.js';

export function configureSockets(io: Server){
 io.use((socket,next)=>{const token=String(socket.handshake.auth.token||'');if(process.env.AUTH_MODE==='clerk'){void verifyToken(token,{secretKey:process.env.CLERK_SECRET_KEY}).then(c=>{const x=c as jwt.JwtPayload&{org_id?:string;org_role?:string;email?:string;name?:string};const roles:Record<string,'admin'|'dispatcher'|'driver'|'customer'>={'org:admin':'admin','org:dispatcher':'dispatcher','org:driver':'driver','org:customer':'customer'};socket.data.user={id:String(x.sub),organizationId:String(x.org_id||process.env.DEFAULT_ORGANIZATION_ID||'org_demo'),name:String(x.name||'RoutePulse user'),email:String(x.email||''),role:roles[String(x.org_role||'org:customer')]||'customer'};next()}).catch(()=>next(new Error('unauthorized')));return;}try{const c=jwt.verify(token,process.env.JWT_SECRET||'routepulse-local-development-only',{issuer:'routepulse',audience:'routepulse-web'}) as jwt.JwtPayload;const user=users.find(u=>u.id===c.sub);if(!user)throw new Error();socket.data.user=user;next()}catch{next(new Error('unauthorized'))}});
 io.on('connection',socket=>{const user=socket.data.user;socket.join(`tenant:${user.organizationId}`);
  socket.on('order:subscribe',(code:string,ack?:Function)=>{const order=orders.find(o=>o.trackingCode===code&&o.organizationId===user.organizationId);if(!order)return ack?.({error:'Not found'});socket.join(`track:${code}`);ack?.({ok:true})});
  let last=0;socket.on('location:update',(raw:unknown,ack?:Function)=>{const now=Date.now();if(now-last<1000)return ack?.({error:'Update rate exceeded'});last=now;const d=drivers.find(x=>x.userId===user.id);if(!d)return ack?.({error:'Driver identity required'});const p=raw as {lat?:number;lng?:number};if(typeof p.lat!=='number'||typeof p.lng!=='number'||Math.abs(p.lat)>90||Math.abs(p.lng)>180)return ack?.({error:'Invalid coordinates'});d.location={lat:p.lat,lng:p.lng};d.lastSeenAt=new Date().toISOString();void persistDriver(d);const update={driverId:d.id,location:d.location,lastSeenAt:d.lastSeenAt};io.to(`tenant:${user.organizationId}`).emit('driver:location',update);orders.filter(o=>o.assignedDriverId===d.id).forEach(o=>io.to(`track:${o.trackingCode}`).emit('driver:location',update));ack?.({ok:true})});
 });
}
