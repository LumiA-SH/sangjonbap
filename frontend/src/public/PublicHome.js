import SystemFeed from './SystemFeed';
import {apiUrl} from '../api/client';
import {publicAsset} from '../publicAsset';
import MobileLoginHelp from '../MobileLoginHelp';
import OAuthErrorNotice from '../OAuthErrorNotice';
import './PublicHome.css';

const publicMenus = [
    {id: 'world', title: '세계관', description: 'WORLD'},
    {id: 'system', title: '시스템 안내', description: 'SYSTEM'},
    {id: 'schedule', title: '러닝 일정', description: 'SCHEDULE'},
    {id: 'roster', title: '캐릭터 목록', description: 'SURVIVORS'}
];

export default function PublicHome({
                                       provider,
                                       authError,
                                       devKey,
                                       onDevKeyChange,
                                       onDevLogin,
                                       onRetry,
                                       onNavigate,
                                       busy
                                   }) {
    function openNotice() {
        document.getElementById('public-entry-notice')?.scrollIntoView({
            behavior: 'smooth',
            block: 'start'
        });
    }

    return (
        <section className="public-entry" aria-label="생존밥 공개 메인">
            <div className="public-entry-visual">
                <img src={publicAsset('main.png')} alt="생존밥 공식 메인 비주얼" className="public-entry-main-image"/>

                <div className="public-entry-auth">
                    {provider === 'mastodon' ? (
                        <a href={apiUrl('/auth/mastodon/login')} className="public-entry-login">
                            <span>ACCESS TERMINAL</span>
                            <strong>마스토돈 로그인</strong>
                        </a>
                    ) : provider === 'dev' ? (
                        <form className="public-entry-dev-login" onSubmit={onDevLogin}>
                            <label htmlFor="public-entry-key">개발 로그인 키</label>
                            <input id="public-entry-key" type="password" placeholder="개발 로그인 키" value={devKey} onChange={event => onDevKeyChange(event.target.value)} disabled={busy} required autoComplete="off"/>
                            <button type="submit" disabled={busy}>개발 로그인</button>
                        </form>
                    ) : authError ? (
                        <div className="public-entry-auth-error" role="alert">
                            <p>인증 연결 오류</p>
                            <button type="button" onClick={onRetry}>다시 시도</button>
                        </div>
                    ) : (
                        <div className="public-entry-connecting" role="status">
                            접속 시스템 확인 중…
                        </div>
                    )}
                </div>
            </div>

            <div className="public-entry-support">
                <OAuthErrorNotice/>
                {provider === 'mastodon' && <MobileLoginHelp/>}
                {authError && <p role="alert">{authError.message}</p>}
            </div>

            <nav className="public-entry-navigation" aria-label="공개 콘텐츠">
                {publicMenus.map(menu => (
                    <button key={menu.id} type="button" onClick={() => onNavigate(menu.id)}>
                        <span>{menu.description}</span>
                        <strong>{menu.title}</strong>
                    </button>
                ))}

                <button type="button" onClick={openNotice}>
                    <span>NOTICE</span>
                    <strong>공지사항</strong>
                </button>
            </nav>

            <section id="public-entry-notice" className="public-entry-notice">
                <div>
                    <span>OFFICIAL NOTICE</span>
                    <h3>공지사항</h3>
                </div>
                <SystemFeed kind="notice" preview onMore={()=>onNavigate('feed-notice')}/>
            </section>
        </section>
    );
}