import {randomUUID} from 'node:crypto';
import {AppError,ok} from '../../shared/http.js';

const BUCKET='survival-images';
const MAX_SIZE=10*1024*1024;

const extensions={
    'image/png':'png',
    'image/jpeg':'jpg',
    'image/webp':'webp',
    'image/gif':'gif'
};

const categories=['items','areas','monsters'];

function environment(name) {
    if (typeof Deno!=='undefined') return Deno.env.get(name);
    return process.env[name];
}

export function mountAdminImageRoutes(router) {
    router.post('/images/sign-upload',async(req,res)=>{
        const {kind,contentType,size}=req.body||{};

        if (!categories.includes(kind)) {
            throw new AppError(400,'INVALID_IMAGE_CATEGORY','이미지 등록 대상을 확인하세요.');
        }

        if (!extensions[contentType]) {
            throw new AppError(400,'INVALID_IMAGE_TYPE','PNG, JPEG, WebP, GIF 이미지만 업로드할 수 있습니다.');
        }

        if (!Number.isInteger(size)||size<1||size>MAX_SIZE) {
            throw new AppError(400,'INVALID_IMAGE_SIZE','이미지는 최대 10MB까지 업로드할 수 있습니다.');
        }

        const supabaseUrl=environment('SUPABASE_URL');
        const serviceKey=environment('SUPABASE_SERVICE_ROLE_KEY');

        if (!supabaseUrl||!serviceKey) {
            throw new AppError(503,'STORAGE_UNAVAILABLE','이미지 저장소 연결이 설정되지 않았습니다.');
        }

        const origin=new URL(supabaseUrl).origin;
        const path=`${kind}/${randomUUID()}.${extensions[contentType]}`;
        const endpoint=`${origin}/storage/v1/object/upload/sign/${BUCKET}/${path}`;

        const response=await fetch(endpoint,{
            method:'POST',
            headers:{
                apikey:serviceKey,
                Authorization:`Bearer ${serviceKey}`,
                'Content-Type':'application/json'
            },
            body:'{}'
        });

        const data=await response.json().catch(()=>null);

        if (!response.ok||typeof data?.url!=='string') {
            throw new AppError(
                502,
                'IMAGE_UPLOAD_SIGN_FAILED',
                '이미지 업로드 주소를 발급하지 못했습니다. 버킷 설정을 확인하세요.'
            );
        }

        const uploadUrl=data.url.startsWith('/object/')
            ? `${origin}/storage/v1${data.url}`
            : data.url;

        const parsed=new URL(uploadUrl);

        if (parsed.origin!==origin||
            !parsed.pathname.startsWith(`/storage/v1/object/upload/sign/${BUCKET}/`)) {
            throw new AppError(502,'INVALID_STORAGE_RESPONSE','저장소가 올바르지 않은 업로드 주소를 반환했습니다.');
        }

        ok(res,{
            uploadUrl,
            imageUrl:`${origin}/storage/v1/object/public/${BUCKET}/${path}`,
            path
        });
    });
}