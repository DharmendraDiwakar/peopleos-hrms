import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.0";
const url=Deno.env.get("SUPABASE_URL")!;
const pub=Deno.env.get("SUPABASE_ANON_KEY")!;
const secret=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const origins=["https://peopleos-next-production.up.railway.app","https://peopleos-live-production.up.railway.app","https://peopleos-platform-admin-production.up.railway.app"];
Deno.serve(async(req:Request)=>{
 const origin=req.headers.get("Origin")||"";
 const h={"Access-Control-Allow-Origin":origins.includes(origin)?origin:origins[0],"Access-Control-Allow-Headers":"authorization, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Content-Type":"application/json"};
 const out=(v:unknown,status=200)=>new Response(JSON.stringify(v),{status,headers:h});
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:h});
 if(req.method!=="POST")return out({error:"Method not allowed"},405);
 if(!origins.includes(origin))return out({error:"Invalid origin"},403);
 try{
  const token=(req.headers.get("Authorization")||"").replace(/^Bearer /,"");
  if(!token)return out({error:"Authentication required"},401);
  const admin=createClient(url,secret,{auth:{autoRefreshToken:false,persistSession:false}});
  const {data:{user},error:authError}=await admin.auth.getUser(token);
  if(authError||!user)return out({error:"Invalid session"},401);
  const {data:caller}=await admin.from("profiles").select("role,active,organization_id").eq("user_id",user.id).maybeSingle();
  const {data:platform}=await admin.from("platform_admins").select("user_id").eq("user_id",user.id).maybeSingle();
  const platformAdmin=!!platform;
  const body=await req.json();
  const email=String(body.email||"").trim().toLowerCase();
  const full_name=String(body.full_name||"").trim();
  const department=String(body.department||"General").trim();
  const job_title=String(body.job_title||"Employee").trim();
  const role=String(body.role||"employee").trim();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||full_name.length<2||full_name.length>100||department.length>100||job_title.length>100)return out({error:"Provide valid employee information"},400);
  if(!["owner","employee","team_leader","manager","hr"].includes(role))return out({error:"Invalid role"},400);
  let organization_id=String(body.organization_id||caller?.organization_id||"");
  const isCompanyOwnerInvite=role==="owner";
  if(isCompanyOwnerInvite){
   if(!platformAdmin||!body.organization_id)return out({error:"Only the platform super admin can provision company owners"},403);
  }else{
   if(!caller?.active||!["owner","hr"].includes(caller.role)||organization_id!==caller.organization_id)return out({error:"You do not have permission to invite employees to this company"},403);
   if(caller.role!=="owner"&&role!=="employee")return out({error:"HR can invite employees only"},403);
  }
  const {data:org,error:orgError}=await admin.from("organizations").select("id,name,status").eq("id",organization_id).maybeSingle();
  if(orgError||!org||org.status==="suspended")return out({error:"Company is not available for invitations"},403);
  if(isCompanyOwnerInvite){
    const {count}=await admin.from("profiles").select("user_id",{count:"exact",head:true}).eq("organization_id",org.id).eq("role","owner");
    if(count&&count>0)return out({error:"This company already has an owner account"},409);
  }
  const loginUrl="https://peopleos-next-production.up.railway.app";
  const inviteData={full_name,company_name:org.name,department,job_title,hrms_login_url:loginUrl,invitation_kind:"employee",organization_id:org.id};
  const {data:sender}=await admin.from("company_mail_settings").select("provider,verification_status,sender_email,display_name,reply_to").eq("organization_id",org.id).maybeSingle();
  const useCompanySender=sender?.provider==="resend"&&sender.verification_status==="verified"&&!!sender.sender_email;
  let invite:any=null,actionLink="",providerKey="";
  if(useCompanySender){
    const {data:key,error:keyErr}=await admin.rpc("get_company_resend_key",{p_org_id:org.id});
    if(keyErr||!key)return out({error:"Company email sender is connected but the secure provider key is unavailable"},409);
    providerKey=key;
    const {data:generated,error:linkErr}=await admin.auth.admin.generateLink({type:"invite",email,options:{redirectTo:loginUrl,data:inviteData}});
    if(linkErr||!generated?.user||!generated.properties?.action_link)return out({error:linkErr?.message||"Unable to generate invitation"},400);
    invite=generated;actionLink=generated.properties.action_link;
  }else{
    const {data:defaultInvite,error:inviteError}=await admin.auth.admin.inviteUserByEmail(email,{redirectTo:loginUrl,data:inviteData});
    if(inviteError||!defaultInvite?.user)return out({error:inviteError?.message||"Unable to create invitation"},400);
    invite=defaultInvite;
  }
  const {error:profileError}=await admin.from("profiles").insert({user_id:invite.user.id,email,full_name,department,job_title,role,active:true,organization_id:org.id});
  if(profileError){
    if(!useCompanySender)await admin.auth.admin.deleteUser(invite.user.id);
    return out({error:"Employee profile could not be created. Contact support before retrying."},500);
  }
  if(useCompanySender){
    const safe=(x:string)=>String(x||"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]||c));
    const html='<div style="font-family:Arial,sans-serif;color:#233657;max-width:600px;margin:auto;padding:25px"><h2>Welcome to '+safe(org.name)+'</h2><p>Hello '+safe(full_name)+',</p><p>You have been invited to your company PeopleOS HRMS. Use the secure link below to activate your account and set your password.</p><p><a href="'+safe(actionLink)+'" style="display:inline-block;background:#3459df;color:white;padding:13px 20px;border-radius:7px;text-decoration:none">Activate your employee account</a></p><p style="font-size:12px;color:#71809a">If you did not expect this invitation, contact your company administrator.</p></div>';
    const senderName=String(sender.display_name||org.name).replace(/[<>\r\n]/g,"").slice(0,90);
    const request={from:senderName+" <"+sender.sender_email+">",to:[email],subject:"Your invitation to "+org.name+" PeopleOS",html,...(sender.reply_to?{reply_to:sender.reply_to}:{})};
    const delivery=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:"Bearer "+providerKey,"Content-Type":"application/json"},body:JSON.stringify(request)});
    if(!delivery.ok){
      await admin.from("profiles").update({active:false}).eq("user_id",invite.user.id);
      return out({error:"Invitation account created but company email delivery was rejected. Contact your company administrator before retrying."},502);
    }
  }
  if(isCompanyOwnerInvite){
    await admin.from("company_settings").upsert({organization_id:org.id,company_name:org.name},{onConflict:"organization_id"});
  }
  return out({ok:true,email,organization_id:org.id,message:"Invitation created",login_url:loginUrl});
 }catch(e){return out({error:e instanceof Error?e.message:"Invitation failed"},500)}
});