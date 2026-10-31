// Timers only trigger work. Database character/battle locks guarantee exactly-once expiry.
export function startBattleExpiry(expire, {onError=()=>{},intervalMs=60000}={}) {
    let stopped=false,timer,pending;
    async function tick() {
        try {while(!stopped && await expire()===100) { /* drain bounded batches */ }}
        catch(error){onError(error);}
        if(!stopped){timer=setTimeout(()=>{pending=tick();},intervalMs);timer.unref?.();}
    }
    pending=tick();
    return {async stop(){stopped=true;clearTimeout(timer);await pending;}};
}
