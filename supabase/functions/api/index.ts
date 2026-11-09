import {createVerificationApi} from './verification.js';

// Never import index.js or start schedulers. All gameplay remains disabled here.
const {app} = createVerificationApi(Deno.env.toObject(), {oauthEnabled:true});
app.listen(8000);
