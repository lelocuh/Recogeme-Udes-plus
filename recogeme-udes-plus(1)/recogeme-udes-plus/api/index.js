const express=require("express"),jwt=require("jsonwebtoken"),bcrypt=require("bcryptjs"),{Redis}=require("@upstash/redis");
const SECRET=process.env.JWT_SECRET||"dev-secret-change-me",FARE=+process.env.FARE||3000,WH=process.env.WEBHOOK_SECRET;
const RU=process.env.UPSTASH_REDIS_REST_URL||process.env.KV_REST_API_URL,RT=process.env.UPSTASH_REDIS_REST_TOKEN||process.env.KV_REST_API_TOKEN;
const redis=RU?new Redis({url:RU,token:RT}):null;let mem=null;
const seed=()=>{const h=bcrypt.hashSync("udes1234",8),c={at:Date.now(),v:"1.0"};return{seq:10,ok:0,bad:0,tickets:[],alerts:[],audit:[],
 users:[{id:1,email:"pasajero@udes.test",name:"Pasajero demo",hash:h,role:"pasajero",consent:c},{id:2,email:"conductor@udes.test",name:"Conductor demo",hash:h,role:"conductor"},{id:3,email:"admin@udes.test",name:"Administrador demo",hash:h,role:"admin"}],
 buses:[{id:1,plate:"UDS-101",capacity:40,occupancy:0,active:0,driver:2},{id:2,plate:"UDS-102",capacity:36,occupancy:0,active:0,driver:null}]}};
const load=async()=>(redis?await redis.get("ru:state"):mem)||seed();
const save=async d=>{d.audit=d.audit.slice(0,60);d.tickets=d.tickets.slice(-300);d.alerts=d.alerts.slice(-30);redis?await redis.set("ru:state",d):mem=d};
const app=express();app.use(express.json());
const A=(...r)=>(q,s,n)=>{try{q.u=jwt.verify((q.headers.authorization||"").slice(7),SECRET);if(r.length&&!r.includes(q.u.role))return s.status(403).json({error:"Sin permiso"});n()}catch{s.status(401).json({error:"Sesión inválida"})}};
const H=f=>async(q,s)=>{try{const d=await load();if(q.u){q.me=d.users.find(u=>u.id==q.u.id);if(!q.me)return s.status(401).json({error:"Sesión inválida"})}if(await f(q,s,d)!==false)await save(d)}catch(e){console.error(e);s.status(500).json({error:"Error del servidor"})}};
const no=(s,c,m)=>(s.status(c).json({error:m}),false);
const log=(d,a,x,t="")=>d.audit.unshift({ts:Date.now(),actor:a,action:x,detail:t});
const tk=u=>jwt.sign({id:u.id,role:u.role},SECRET,{expiresIn:"12h"});
const mine=(d,q)=>d.buses.find(b=>b.driver==q.me.id);

app.post("/api/register",H((q,s,d)=>{const{name,email,password,consent}=q.body||{};
  if(consent!==true)return no(s,400,"Debes aceptar el tratamiento de datos para registrarte");
  if(!/^\S+@\S+\.\S+$/.test(email||"")||String(password||"").length<8||!String(name||"").trim())return no(s,400,"Revisa nombre, correo y contraseña (mínimo 8 caracteres)");
  const e=email.toLowerCase();if(d.users.some(u=>u.email==e))return no(s,409,"Ese correo ya está registrado");
  const u={id:d.seq++,email:e,name:String(name).trim().slice(0,60),hash:bcrypt.hashSync(password,8),role:"pasajero",consent:{at:Date.now(),v:"1.0"}};
  d.users.push(u);log(d,e,"register","consentimiento v1.0");s.json({token:tk(u)})}));
app.post("/api/login",H((q,s,d)=>{const u=d.users.find(x=>x.email==String((q.body||{}).email||"").toLowerCase());
  if(!u||!bcrypt.compareSync(String(q.body.password||""),u.hash)){log(d,String(q.body.email),"login_failed");s.status(401).json({error:"Correo o contraseña incorrectos"});return true}
  s.json({token:tk(u)});return false}));

app.get("/api/state",A(),H((q,s,d)=>{const now=Date.now(),r=q.me.role,nm=id=>(d.users.find(u=>u.id==id)||{name:"Usuario eliminado"}).name;
  const buses=d.buses.map(b=>({id:b.id,plate:b.plate,capacity:b.capacity,occupancy:b.occupancy,active:b.active,lat:b.lat,lng:b.lng,age:b.sig?Math.round((now-b.sig)/1000):null}));
  const alerts=d.alerts.filter(a=>a.on&&now-a.ts<72e5),o={role:r,name:q.me.name,fare:FARE,buses,alerts};
  if(r=="pasajero"){const m=d.tickets.filter(t=>t.user==q.me.id).slice(-8);o.open=m.find(t=>!t.out)||null;o.debts=m.filter(t=>t.out&&t.st!="pagado")}
  if(r=="conductor"){const b=mine(d,q),T=d.tickets.filter(t=>b&&t.bus==b.id);o.bus=b?b.id:null;
    o.aboard=T.filter(t=>!t.out).map(t=>({n:nm(t.user),st:t.st,rc:t.rc}));o.debts=T.filter(t=>t.out&&t.st!="pagado").slice(-10).map(t=>({n:nm(t.user),ts:t.ts}));o.paid=T.filter(t=>t.st=="pagado").length}
  if(r=="admin"){const ages=buses.filter(b=>b.active&&b.age!=null).map(b=>b.age);o.stats={ok:d.ok,bad:d.bad,rate:d.ok+d.bad?Math.round(d.ok/(d.ok+d.bad)*100):null,age:ages.length?Math.round(ages.reduce((x,y)=>x+y)/ages.length):null,paid:d.tickets.filter(t=>t.st=="pagado").length,debt:d.tickets.filter(t=>t.out&&t.st!="pagado").length};o.audit=d.audit.slice(0,30)}
  s.json(o);return false}));

app.post("/api/scan",A("pasajero"),H((q,s,d)=>{const b=d.buses.find(x=>x.id==q.body.bus_id);if(!b||!b.active)return no(s,409,"El bus no tiene una ruta activa");
  const rej=m=>{d.bad++;log(d,q.me.email,"scan_rejected",m);s.status(409).json({error:m});return true};
  if(d.tickets.some(t=>t.user==q.me.id&&!t.out))return rej("Ya tienes un abordaje abierto: registra tu descenso primero");
  if(b.occupancy>=b.capacity)return rej("El bus está lleno");
  d.tickets.push({id:d.seq++,user:q.me.id,bus:b.id,ts:Date.now(),out:0,st:"pendiente"});b.occupancy++;d.ok++;log(d,q.me.email,"scan","abordaje en "+b.plate);s.json({ok:true})}));
app.post("/api/alight",A("pasajero"),H((q,s,d)=>{const t=d.tickets.find(x=>x.user==q.me.id&&!x.out);if(!t)return no(s,409,"No tienes un abordaje abierto");
  t.out=1;const b=d.buses.find(x=>x.id==t.bus);if(b)b.occupancy=Math.max(0,b.occupancy-1);log(d,q.me.email,"alight",t.st=="pagado"?"pagado":"queda deuda");s.json({ok:true})}));
app.post("/api/pay",A("pasajero"),H((q,s,d)=>{const t=d.tickets.find(x=>x.id==q.body.ticket&&x.user==q.me.id);if(!t)return no(s,404,"Pasaje no encontrado");
  if(process.env.DEMO_PAYMENTS=="0")return no(s,403,"Pago real aún no configurado");
  if(t.st!="pagado"){t.st="pagado";t.rc="CP-"+Math.random().toString(36).slice(2,8).toUpperCase();t.paidAt=Date.now();log(d,q.me.email,"paid",t.rc)}s.json({rc:t.rc})}));
app.post("/api/payments/webhook",H((q,s,d)=>{if(!WH||q.headers["x-webhook-secret"]!=WH)return no(s,401,"No autorizado");
  const t=d.tickets.find(x=>x.id==q.body.ticket);if(!t||q.body.status!="APPROVED")return no(s,400,"Datos no válidos");
  t.st="pagado";t.rc=String(q.body.receipt||"WH-"+t.id).slice(0,30);log(d,"webhook","paid",t.rc);s.json({ok:true})}));

const D=A("conductor");
app.post("/api/driver/start",D,H((q,s,d)=>{const b=mine(d,q);if(!b)return no(s,404,"No tienes un bus asignado");b.occupancy=Math.min(b.capacity,Math.max(0,parseInt(q.body.initial)||0));b.active=1;b.sig=null;log(d,q.me.email,"route_start",b.plate);s.json({ok:true})}));
app.post("/api/driver/end",D,H((q,s,d)=>{const b=mine(d,q);if(!b)return no(s,404,"No tienes un bus asignado");d.tickets.forEach(t=>{if(t.bus==b.id)t.out=1});log(d,q.me.email,"route_end",`${b.plate}, conciliada desde ${b.occupancy} a 0`);b.active=0;b.occupancy=0;d.alerts.forEach(a=>{if(a.bus==b.id)a.on=0});s.json({ok:true})}));
app.post("/api/driver/location",D,H((q,s,d)=>{const b=mine(d,q),{lat,lng}=q.body;if(!b||!b.active||![lat,lng].every(Number.isFinite)||Math.abs(lat)>90||Math.abs(lng)>180)return no(s,400,"Ubicación o sesión no válida");
  b.lat=lat;b.lng=lng;b.sig=Date.now();s.json({ok:true})}));
app.post("/api/driver/adjust",D,H((q,s,d)=>{const b=mine(d,q),x=parseInt(q.body.delta);if(!b||!b.active||![1,-1].includes(x))return no(s,400,"Ajuste no válido");
  const n=b.occupancy+x;if(n<0||n>b.capacity)return no(s,409,"Fuera de los límites de capacidad");b.occupancy=n;log(d,q.me.email,"adjust",`${x>0?"+1 pasaje excepcional":"-1 descenso"} en ${b.plate}`);s.json({ok:true})}));
app.post("/api/driver/alert",D,H((q,s,d)=>{const b=mine(d,q);if(!b)return no(s,404,"No tienes un bus asignado");
  d.alerts.push({id:d.seq++,bus:b.id,plate:b.plate,type:String(q.body.type||"Incidencia").slice(0,40),ts:Date.now(),on:1});log(d,q.me.email,"incident",q.body.type);s.json({ok:true})}));
app.post("/api/driver/alert/clear",D,H((q,s,d)=>{const b=mine(d,q);d.alerts.forEach(a=>{if(b&&a.bus==b.id)a.on=0});s.json({ok:true})}));

app.put("/api/admin/buses/:id",A("admin"),H((q,s,d)=>{const c=parseInt(q.body.capacity),b=d.buses.find(x=>x.id==q.params.id);if(!b||!(c>=1&&c<=100))return no(s,400,"Capacidad entre 1 y 100");
  b.capacity=c;b.occupancy=Math.min(b.occupancy,c);b.active=q.body.active?1:0;log(d,q.me.email,"bus_update",`${b.plate}: capacidad ${c}, activo ${b.active}`);s.json({ok:true})}));
app.delete("/api/me",A("pasajero"),H((q,s,d)=>{d.tickets.forEach(t=>{if(t.user==q.me.id){if(!t.out){const b=d.buses.find(x=>x.id==t.bus);if(b)b.occupancy=Math.max(0,b.occupancy-1);t.out=1}t.user=null}});
  d.users=d.users.filter(u=>u.id!=q.me.id);log(d,"sistema","account_deleted","derecho de supresión");s.json({ok:true})}));
module.exports=app;
