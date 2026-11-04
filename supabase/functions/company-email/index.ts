import { createClient } from "npm:@supabase/supabase-js@2.57.0";
const url=Deno.env.get("SUPABASE_URL");
const service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const allowed=new Set(["https://peopleos-next-production.up.railway.app"]);
const db=createClient(url,service,{auth:{autoRefreshToken:false,persistSession:false}});
const mail=(s)=>String(s||"").trim().toLowerCase();
const validMail=(s)=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
const esc=(s)=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const send=async(key,data)=>{
 const response=await fetch("https://api.resend.com/emails",{method:"POST",headers:{"Authorization":"Bearer "+key,"Content-Type":"application/json"},body:JSON.stringify(data)});
 if(!response.ok){const json=await response.json().catch(()=>({}));throw Error("Email provider rejected delivery: "+String(json.message||response.status).slice(0,180))}
 return response.json();
};
Deno.serve(async(req)=>{
 const origin=req.headers.get("Origin")||"";
 const headers={"Access-Control-Allow-Origin":allowed.has(origin)?origin:"https://peopleos-next-production.up.railway.app","Access-Control-Allow-Methods":"POST, OPTIONS","Access-Control-Allow-Headers":"authorization, apikey, content-type","Content-Type":"application/json","Cache-Control":"no-store"};
 const res=(data,status=200)=>new Response(JSON.stringify(data),{status,headers});
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers});
 if(req.method!=="POST"||!allowed.has(origin))return res({error:"Not permitted"},403);
 try{
  const bearer=(req.headers.get("Authorization")||"").replace(/^Bearer /,"");
  const {data:{user},error:authError}=await db.auth.getUser(bearer);
  if(authError||!user)return res({error:"Sign in required"},401);
  const {data:actor}=await db.from("profiles").select("role,active,organization_id").eq("user_id",user.id).maybeSingle();
  if(!actor?.active||!actor.organization_id)return res({error:"Active company membership required"},403);
  const {data:org}=await db.from("organizations").select("id,name,status").eq("id",actor.organization_id).maybeSingle();
  if(!org||!["active","trial"].includes(org.status))return res({error:"Company is not active"},403);
  const body=await req.json().catch(()=>({}));
  const action=String(body.action||"");
  const {data:config}=await db.from("company_mail_settings").select("*").eq("organization_id",org.id).maybeSingle();
  if(action==="connect"){
   if(actor.role!=="owner")return res({error:"Company owner permission required"},403);
   const key=String(body.api_key||"").trim(),sender=mail(body.sender_email),reply=mail(body.reply_to),display=String(body.display_name||org.name).trim().slice(0,100);
   if(!/^re_[A-Za-z0-9_]{18,509}$/.test(key))return res({error:"Enter a valid Resend API key"},400);
   if(!validMail(sender)||reply&&!validMail(reply)||!display)return res({error:"Valid sender and reply-to required"},400);
   const r=await fetch("https://api.resend.com/domains?limit=100",{headers:{"Authorization":"Bearer "+key}});
   if(!r.ok)return res({error:"Provider access failed. Use a key with domain-list permissions."},400);
   const domains=await r.json(),senderDomain=sender.split("@")[1];
   const verified=(domains.data||[]).some(d=>String(d.name).toLowerCase()===senderDomain&&d.status==="verified"&&d.capabilities?.sending!=="disabled");
   if(!verified)return res({error:"Sender domain not verified for sending in your Resend account. Complete DNS verification first."},400);
   const {error:pendingErr}=await db.from("company_mail_settings").update({display_name:display,sender_email:sender,reply_to:reply||null,provider:"resend",verification_status:"pending_verification"}).eq("organization_id",org.id);
   if(pendingErr)throw Error("Unable to prepare email connection");
   const {error:storeErr}=await db.rpc("store_company_resend_key",{p_org_id:org.id,p_key:key});
   if(storeErr)throw Error("Secure credential storage failed");
   const {error:finalErr}=await db.from("company_mail_settings").update({provider:"resend",verification_status:"verified",display_name:display,sender_email:sender,reply_to:reply||null}).eq("organization_id",org.id);
   if(finalErr)throw Error("Email connection could not be finalized");
   return res({ok:true,verified:true,sender_email:sender,provider:"resend"});
  }
  if(action==="disconnect"){
   if(actor.role!=="owner")return res({error:"Company owner permission required"},403);
   const {error:off}=await db.from("company_mail_settings").update({provider:"unconfigured",verification_status:"not_connected"}).eq("organization_id",org.id);
   if(off)throw Error("Could not disable sending");
   await db.rpc("delete_company_resend_key",{p_org_id:org.id});
   return res({ok:true,verified:false});
  }
  if(!config||config.verification_status!=="verified"||config.provider!=="resend"||!validMail(config.sender_email))return res({error:"Connect a verified company sender first"},409);
  const {data:key,error:keyErr}=await db.rpc("get_company_resend_key",{p_org_id:org.id});
  if(keyErr||!key)return res({error:"Company email credentials unavailable"},409);
  const from=String(config.display_name||org.name).replace(/[<>\r\n]/g,"").slice(0,90)+" <"+config.sender_email+">";
  const replyTo=config.reply_to&&validMail(config.reply_to)?config.reply_to:undefined;
  if(action==="test"){
   if(actor.role!=="owner")return res({error:"Company owner permission required"},403);
   if(!validMail(user.email||""))return res({error:"Owner account has no valid email"},400);
   const sent=await send(key,{from,to:[user.email],reply_to:replyTo,subject:org.name+" — email connection test",html:"<h2>Company email connected</h2><p>A verified company sender has successfully delivered this PeopleOS test message.</p>"});
   return res({ok:true,provider_message_id:sent.id});
  }
  if(action==="payslip"){
   if(!["owner","hr"].includes(actor.role))return res({error:"HR or Owner permission required"},403);
   const payrollId=String(body.payroll_id||"");
   if(!/^[0-9a-f-]{36}$/i.test(payrollId))return res({error:"Invalid payroll reference"},400);
   const {data:pay}=await db.from("payroll").select("*").eq("id",payrollId).eq("organization_id",org.id).maybeSingle();
   if(!pay||!["approved","paid"].includes(pay.status))return res({error:"Only approved or paid payroll statements can be emailed"},400);
   const {data:employee}=await db.from("profiles").select("email,full_name,employee_code,organization_id").eq("user_id",pay.user_id).maybeSingle();
   if(!employee||employee.organization_id!==org.id||!validMail(employee.email))return res({error:"Valid company employee email required"},400);
   const currency=String(pay.currency||"INR");
   const number=n=>new Intl.NumberFormat("en",{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(n||0));
   const net=Number(pay.basic||0)+Number(pay.allowances||0)-Number(pay.deductions||0);
   const {data:brand}=await db.from("payslip_branding").select("*").eq("organization_id",org.id).maybeSingle();
   const {data:detail}=await db.from("organization_details").select("*").eq("organization_id",org.id).maybeSingle();
   const company=String(brand?.authorized_company_name||detail?.legal_name||org.name);
   const companyAddress=String(brand?.address||[detail?.address_line,detail?.city,detail?.region,detail?.country].filter(Boolean).join(", "));
   const approvedUrl=(v)=>typeof v==="string"&&v.startsWith("https://")&&!/["'<>\\s]/.test(v)?v:null;
   let logo=approvedUrl(brand?.logo_url);
   let seal=approvedUrl(brand?.seal_url);
   if(brand?.logo_path){
     const {data,error}=await db.storage.from("peopleos-company-branding").createSignedUrl(brand.logo_path,604800);
     if(!error&&data?.signedUrl)logo=data.signedUrl;
   }
   if(brand?.seal_path){
     const {data,error}=await db.storage.from("peopleos-company-branding").createSignedUrl(brand.seal_path,604800);
     if(!error&&data?.signedUrl)seal=data.signedUrl;
   }
   const gross=Number(pay.basic||0)+Number(pay.allowances||0);
   const line=(label,value)=>"<tr><td style='padding:11px;border-bottom:1px solid #e8edf3'>"+esc(label)+"</td><td style='padding:11px;text-align:right;border-bottom:1px solid #e8edf3'>"+esc(currency)+" "+number(value)+"</td></tr>";
   const period=new Date(pay.month+"T12:00:00Z").toLocaleDateString("en-GB",{month:"long",year:"numeric"});
   let footerNote=String(brand?.payslip_note||"");
   if(footerNote.startsWith("PO_CUSTOM_TEMPLATE_V1:")){
     try{let template=JSON.parse(footerNote.slice("PO_CUSTOM_TEMPLATE_V1:".length));footerNote=String(template.note||"")}catch{footerNote=""}
   }
   const html="<div style='font:14px Arial,sans-serif;max-width:720px;margin:auto;padding:25px;color:#253650;background:#fff'>"
    +"<header style='display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid #28477d;padding-bottom:18px'><div><h2 style='margin:0 0 6px'>"+esc(company)+"</h2><small>"+esc(companyAddress)+"</small><p style='margin:4px 0;font-size:11px'>"+esc(brand?.registration_label||detail?.registration_number||"")+"</p></div>"
    +(logo?"<img src='"+esc(logo)+"' alt='Company logo' style='max-width:135px;max-height:76px'>":"")+"</header>"
    +"<p style='color:#60708c;letter-spacing:1px;font-size:11px;margin-top:22px'>CONFIDENTIAL EMPLOYEE PAYROLL DOCUMENT</p>"
    +"<h2>Monthly Payslip — "+esc(period)+"</h2><p><b>Employee:</b> "+esc(employee.full_name)+" · <b>Employee ID:</b> "+esc(employee.employee_code||"—")+"</p>"
    +"<p><b>Payroll status:</b> "+esc(pay.status)+" · <b>Reference:</b> "+esc(String(pay.id).slice(0,12).toUpperCase())+"</p>"
    +"<table style='border-collapse:collapse;width:100%'><thead><tr style='background:#eff3fb'><th style='text-align:left;padding:12px'>Earnings and deductions</th><th style='text-align:right;padding:12px'>Amount</th></tr></thead><tbody>"
    +line("Basic salary",pay.basic)+line("Allowances",pay.allowances)+line("Gross earnings",gross)+line("Deductions",pay.deductions)+"</tbody></table>"
    +"<div style='margin-top:18px;background:#eff3fb;padding:16px;font-size:19px;font-weight:bold'>Net pay: "+esc(currency)+" "+number(net)+"</div>"
    +"<div style='margin-top:28px;display:flex;justify-content:space-between;align-items:center'><div><small>Authorized company signatory</small><p>"+esc(brand?.authorized_signatory_name||"Not configured")+"<br>"+esc(brand?.authorized_signatory_title||"")+"</p></div>"
    +(seal?"<img src='"+esc(seal)+"' alt='Company-provided authorized seal' style='max-width:120px;max-height:85px'>":"")+"</div>"
    +"<p style='color:#66758b;font-size:11px;margin-top:28px'>"+esc(footerNote||"For payroll queries, contact your company HR department.")+"</p>"
    +"<p style='color:#77849a;font-size:10px'>This pay statement reflects recorded payroll. Statutory taxes and other required components must be calculated and confirmed by your company's payroll administrator.</p></div>";
   const sent=await send(key,{from,to:[employee.email],reply_to:replyTo,subject:org.name+" — Pay statement "+pay.month,html});
   return res({ok:true,provider_message_id:sent.id});
  }
  return res({error:"Unsupported action"},400);
 }catch(e){return res({error:e instanceof Error?e.message:"Company email operation failed"},500)}
});