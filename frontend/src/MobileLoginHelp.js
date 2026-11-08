import React, {useState} from 'react';
export default function MobileLoginHelp() {
    const [message,setMessage]=useState('');
    const gameUrl='https://survivalbob.site/';
    async function copy() {
        try { await navigator.clipboard.writeText(gameUrl);setMessage('게임 주소를 복사했습니다. Safari 또는 Chrome에서 열고 새로 로그인하세요.'); }
        catch {setMessage('주소를 직접 복사해 Safari 또는 Chrome에서 열어 주세요: '+gameUrl);}
    }
    return <div>
        <p>마스토돈 앱 안에서 열었다면 Safari 또는 Chrome에서 게임을 열고 로그인해 주세요. 앱의 로그인 상태는 공유되지 않을 수 있습니다.</p>
        <button type="button" onClick={copy}>게임 주소 복사</button>
        <p>로그인 요청이 만료되었거나 일치하지 않으면 게임으로 돌아와 새로 로그인하세요. 인증 도중의 주소는 복사하지 마세요.</p>
        <p role="status">{message}</p>
    </div>;
}
