import {Router} from 'express';
import {AppError,ok} from '../../shared/http.js';
import {validPublicId} from '../character/interactions.js';
export function publicContentRoutes(repo,sessions){const router=Router();
 router.get('/events',async(req,res)=>ok(res,await repo.getPublicEvents()));
 router.get('/events/featured',async(req,res)=>{const data=await repo.getPublicEvents();ok(res,{record:data.featured,serverNow:data.serverNow});});
 router.get('/events/:id',async(req,res)=>{if(!validPublicId(req.params.id))throw new AppError(400,'INVALID_ID','이벤트 ID를 확인하세요.');ok(res,await repo.getPublicEvents(req.params.id));});
 router.use('/system-feed',(req,res,next)=>{res.set('Cache-Control','private, no-store');res.vary('Cookie');next();},sessions.require);
 router.get('/system-feed/connection',async(req,res)=>{if(Object.keys(req.query).length)throw new AppError(400,'INVALID_FEED_QUERY','게시글 조회 조건을 확인하세요.');ok(res,await repo.getSystemFeedConnection());});
 router.get('/system-feed/revision',async(req,res)=>{if(Object.keys(req.query).length)throw new AppError(400,'INVALID_FEED_QUERY','게시글 조회 조건을 확인하세요.');ok(res,await repo.getSystemFeedRevision());});
 router.get('/system-feed',async(req,res)=>{const {kind='activity',before=null}=req.query;if(Object.keys(req.query).some(k=>!['kind','before'].includes(k)))throw new AppError(400,'INVALID_FEED_QUERY','게시글 조회 조건을 확인하세요.');if(!repo.getSystemFeed)throw new AppError(503,'SYSTEM_FEED_UNAVAILABLE','게시글 조회가 준비되지 않았습니다.');ok(res,await repo.getSystemFeed(kind,before,{includeFollowers:kind==='activity'}));});
 router.get('/anemia',async(req,res)=>{if(!repo.getAnemiaPolicy)throw new AppError(503,'POLICY_NOT_CONFIGURED','운영 정책 저장소가 준비되지 않았습니다.');ok(res,await repo.getAnemiaPolicy());});
 router.get('/guides/:kind',async(req,res)=>{if(!repo.getPublicContent)throw new AppError(503,'CONTENT_NOT_CONFIGURED','안내 저장소가 준비되지 않았습니다.');ok(res,await repo.getPublicContent(req.params.kind));});
 router.get('/characters',async(req,res)=>{const {q='',after='0'}=req.query;if(Object.keys(req.query).some(k=>!['q','after'].includes(k))||typeof q!=='string'||q.length>100||!(after==='0'||validPublicId(after)))throw new AppError(400,'INVALID_QUERY','검색 조건을 확인하세요.');const rows=await repo.listVisitorCharacters(q,after);ok(res,{records:rows.slice(0,30),nextAfter:rows.length>30?rows[29].id:null});});
 router.get('/characters/:id',async(req,res)=>{if(!validPublicId(req.params.id))throw new AppError(400,'INVALID_CHARACTER_ID','캐릭터 ID를 확인하세요.');ok(res,{character:await repo.getVisitorCharacter(req.params.id)});});return router;
}
