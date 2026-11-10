import {createVerificationApi} from './verification.js';

// Never import index.js or start schedulers. Gameplay remains limited to server-authorized test participants.
const {app} = createVerificationApi(Deno.env.toObject(), {oauthEnabled:true, adminEnabled:true, gameTestingEnabled:true});
app.listen(8000);
