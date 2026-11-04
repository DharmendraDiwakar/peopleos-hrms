import { createClient } from "npm:@supabase/supabase-js@2.57.0";
const url=Deno.env.get("SUPABASE_URL")||"",service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
const db=createClient(url,service,{auth:{autoRefreshToken:false,persistSession:false}});
const portal="https://peopleos-next-production.up.railway.app";
const validId=(x)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
Deno.serve(async req=>{
 const origin=req.headers.get("Origin")||"";
 const headers={"Access-Control-Allow-Origin":origin===portal?portal:"null","Access-Control-Allow-Methods":"POST,OPTIONS","Access-Control-Allow-Headers":"authorization,apikey,content-type","Content-Type":"application/json","Cache-Control":"no-store"};
 const result=(data,status=200)=>new Response(JSON.stringify(data),{status,headers});
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers});
 if(req.method!=="POST"||origin!==portal)return result({error:"Not permitted"},403);
 try{
  const jwt=(req.headers.get("Authorization")||"").replace(/^Bearer /i,"");
  const {data:{user},error:userError}=await db.auth.getUser(jwt);
  if(userError||!user)return result({error:"Authentication required"},401);
  const {data:actor}=await db.from("profiles").select("organization_id,role,active,phone,full_name").eq("user_id",user.id).maybeSingle();
  if(!actor?.active||!actor.organization_id)return result({error:"Active employee account required"},403);
  const {data:organization}=await db.from("organizations").select("id,name,status").eq("id",actor.organization_id).maybeSingle();
  if(!organization||!["active","trial"].includes(organization.status))return result({error:"Company inactive"},403);
  const body=await req.json().catch(()=>({}));
  const action=String(body.action||"");
  const {data:preference}=await db.from("employee_alert_preferences").select("attendance_sms,consented_at").eq("user_id",user.id).eq("organization_id",actor.organization_id).maybeSingle();
  const configured=!!(Deno.env.get("TWILIO_ACCOUNT_SID")&&Deno.env.get("TWILIO_AUTH_TOKEN")&&Deno.env.get("TWILIO_FROM_NUMBER"));
  if(action==="status")return result({ok:true,provider_configured:configured,enabled:!!preference?.attendance_sms,phone_on_file:!!actor.phone});
  if(action!=="notify")return result({error:"Unsupported action"},400);
  if(!preference?.attendance_sms||!preference?.consented_at)return result({ok:true,sent:false,reason:"employee_opt_in_required"});
  if(!configured)return result({ok:true,sent:false,reason:"sms_provider_not_configured"});
  const number=String(actor.phone||"").trim();
  if(!/^\+[1-9][0-9]{7,14}$/.test(number))return result({ok:true,sent:false,reason:"employee_phone_must_be_e164"});
  const attendanceId=String(body.attendance_id||""),event=String(body.event_type||"");
  if(!validId(attendanceId)||!["check_in","check_out"].includes(event))return result({error:"Invalid attendance event"},400);
  const {data:attendance}=await db.from("attendance").select("id,user_id,organization_id,check_in,check_out").eq("id",attendanceId).eq("user_id",user.id).eq("organization_id",actor.organization_id).maybeSingle();
  if(!attendance)return result({error:"Attendance record not found"},404);
  const stamp=attendance[event];
  if(!stamp)return result({error:"Attendance punch not recorded"},400);
  const time=new Date(stamp).getTime();
  if(!Number.isFinite(time)||Date.now()-time>30*60*1000||time>Date.now()+60*1000)return result({ok:true,sent:false,reason:"event_outside_notification_window"});
  const {data:existing}=await db.from("attendance_alert_delivery").select("delivery_status").eq("attendance_id",attendanceId).eq("event_type",event).eq("channel","sms").maybeSingle();
  if(existing)return result({ok:true,sent:false,reason:"already_processed",status:existing.delivery_status});
  const {data:tracking,error:insertError}=await db.from("attendance_alert_delivery").insert({organization_id:actor.organization_id,user_id:user.id,attendance_id:attendanceId,event_type:event,channel:"sms",delivery_status:"pending"}).select("id").single();
  if(insertError)return result({ok:true,sent:false,reason:"notification_already_queued"});
  const {data:settings}=await db.from("company_settings").select("time_zone").eq("organization_id",actor.organization_id).maybeSingle();
  let displayTime;
  try{displayTime=new Intl.DateTimeFormat("en-GB",{dateStyle:"medium",timeStyle:"short",timeZone:settings?.time_zone||"UTC"}).format(new Date(stamp))}
  catch{displayTime=new Date(stamp).toISOString()}
  const message=organization.name+": your attendance "+(event==="check_in"?"check-in":"check-out")+" was recorded at "+displayTime+". This is an automatic attendance alert; no continuous location tracking is performed.";
  const account=Deno.env.get("TWILIO_ACCOUNT_SID")||"",token=Deno.env.get("TWILIO_AUTH_TOKEN")||"",from=Deno.env.get("TWILIO_FROM_NUMBER")||"";
  try{
   const response=await fetch("https://api.twilio.com/2010-04-01/Accounts/"+encodeURIComponent(account)+"/Messages.json",{
    method:"POST",headers:{"Authorization":"Basic "+btoa(account+":"+token),"Content-Type":"application/x-www-form-urlencoded"},
    body:new URLSearchParams({To:number,From:from,Body:message}),signal:AbortSignal.timeout(15000)
   });
   const payload=await response.json().catch(()=>({}));
   if(!response.ok||!payload.sid)throw Error("Provider rejected SMS: "+String(payload.code||response.status));
   await db.from("attendance_alert_delivery").update({delivery_status:"sent",provider_message_id:String(payload.sid),updated_at:new Date().toISOString()}).eq("id",tracking.id);
   return result({ok:true,sent:true});
  }catch(err){
   await db.from("attendance_alert_delivery").update({delivery_status:"failed",error_note:String(err instanceof Error?err.message:"SMS delivery failed").slice(0,150),updated_at:new Date().toISOString()}).eq("id",tracking.id);
   return result({ok:true,sent:false,reason:"provider_delivery_failed"});
  }
 }catch(error){return result({error:error instanceof Error?error.message:"Attendance SMS service error"},500)}
});