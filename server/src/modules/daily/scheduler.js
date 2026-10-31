export function millisecondsUntilKstMidnight(now=Date.now()) {
    const day=86400000,offset=9*3600000;
    return day-((now+offset)%day);
}

// DB state/row locks, not this local timer, provide exactly-once execution.
// A bounded retry also recovers from suspend/network outages without restart.
export function startDailyScheduler(recover,{onError=()=>{},onHold=()=>{}}={}) {
    let stopped=false,timer,pending;
    async function tick() {
        try {const result=await recover();if(result.hold)onHold(result.hold);}
        catch(error){onError(error);}
        if(!stopped){timer=setTimeout(()=>{pending=tick();},Math.min(60000,millisecondsUntilKstMidnight()));timer.unref?.();}
    }
    pending=tick();
    return {async stop(){stopped=true;clearTimeout(timer);await pending;}};
}
