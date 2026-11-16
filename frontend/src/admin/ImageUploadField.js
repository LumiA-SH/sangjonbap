import {useState} from 'react';
import {api} from '../api/client';

const MAX_SIZE=10*1024*1024;
const ALLOWED_TYPES=['image/png','image/jpeg','image/webp','image/gif'];

export default function ImageUploadField({
  label='이미지',kind,value,onChange,disabled=false,onDenied=()=>{},onUploadingChange=()=>{}
}) {
  const [uploading,setUploading]=useState(false);
  const [message,setMessage]=useState('');
  const [failedPreview,setFailedPreview]=useState(null);

  async function upload(event) {
    const file=event.target.files?.[0];
    event.target.value='';
    if (!file||uploading||disabled) return;

    if (!ALLOWED_TYPES.includes(file.type)) {
      setMessage('PNG, JPEG, WebP, GIF 파일만 사용할 수 있습니다.');
      return;
    }

    if (file.size<1||file.size>MAX_SIZE) {
      setMessage('이미지는 최대 10MB까지 업로드할 수 있습니다.');
      return;
    }

    setUploading(true);
    onUploadingChange(true);
    setMessage('');

    try {
      const signed=await api('/admin/images/sign-upload',{
        method:'POST',
        body:{kind,contentType:file.type,size:file.size}
      });

      const response=await fetch(signed.uploadUrl,{
        method:'PUT',
        headers:{'Content-Type':file.type},
        body:file
      });

      if (!response.ok) throw new Error(`이미지 업로드 실패 (${response.status})`);
      onChange(signed.imageUrl);
      setMessage('이미지 업로드 완료. 저장 버튼을 눌러 반영하세요.');
    } catch(error) {
      setMessage(`${error.code||'UPLOAD_FAILED'}: ${error.message}`);
      if ([401,403].includes(error.status)) onDenied(error.message);
    } finally {
      setUploading(false);
      onUploadingChange(false);
    }
  }

  return (
      <div className="admin-image-upload">
        <div className="admin-image-preview">
          {value&&failedPreview!==value?<img src={value} alt={`${label} 미리보기`} width="152" height="152" onError={()=>setFailedPreview(value)}/>:<span role="img" aria-label={`${label} 미리보기 없음`}>{value?'이미지를 불러올 수 없습니다':'등록된 이미지 없음'}</span>}
        </div>
        <label>
          {label}
          <input type="file" accept=".png,.jpg,.jpeg,.webp,.gif" disabled={disabled||uploading} onChange={upload}/>
        </label>
        {value&&<div>
          <button type="button" disabled={disabled||uploading} onClick={()=>onChange(null)}>이미지 제거</button>
        </div>}
        <p role="status">{uploading?'이미지 업로드 중…':message}</p>
      </div>
  );
}
