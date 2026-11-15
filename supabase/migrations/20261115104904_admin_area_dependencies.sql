-- Existing installations keep their objects, permissions and data unchanged.
do $dependencies$
begin
 if to_regclass('public.area_recipe') is null then
-- Dependencies already used by area/recipe management. No legacy data conversion.
create table public.area_recipe (
 area_id bigint not null references public.area(id),
 recipe_id bigint not null references public.recipe(id),
 weight integer not null default 1 check(weight>0),
 drop_rate numeric(5,2) not null default 0 check(drop_rate between 0 and 100),
 primary key(area_id,recipe_id)
);
create index if not exists idx_area_recipe_recipe_id on public.area_recipe(recipe_id);
alter table public.area_recipe enable row level security;
revoke all on public.area_recipe from public, anon, authenticated;

 if exists(select 1 from pg_roles where rolname='service_role') then
  grant select,insert,update,delete on public.area_recipe to service_role;
 end if;
 end if;
end $dependencies$;
-- Preserve an existing view; do not silently replace an installed calculation.
do $migration$
begin
 if to_regclass('public.investigation_progress') is null then
 execute $view$
 create view public.investigation_progress with (security_invoker=true) as
 select a.id area_id, counts.total_count, counts.discovered_count,
 case when counts.total_count=0 then 0::numeric
 else round(100.0*counts.discovered_count/counts.total_count,2) end investigation_rate
 from public.area a
 cross join lateral (
  select coalesce(sum(v.total_count),0)::bigint total_count,
         coalesce(sum(v.discovered_count),0)::bigint discovered_count
  from (
   select count(*) total_count,count(d.investigation_result_id) discovered_count
   from public.investigation_result r left join public.unique_discovery d on d.investigation_result_id=r.id
   where r.area_id=a.id and r.is_unique and r.is_active
   union all
   select count(*),count(m.first_discoverer_id)
   from public.area_monster am join public.monster m on m.id=am.monster_id
   where am.area_id=a.id and m.is_active
   union all
   select count(*),count(d.recipe_id)
   from public.area_recipe ar join public.recipe r on r.id=ar.recipe_id
   left join public.recipe_discovery d on d.recipe_id=r.id
   where ar.area_id=a.id and r.is_active
  ) v
 ) counts
 $view$;
 execute 'revoke all on public.investigation_progress from public, anon, authenticated';
 end if;
end $migration$;
