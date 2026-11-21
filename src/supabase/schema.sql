-- Run in Supabase > SQL Editor. Replace yourschool.edu.ph first.
create or replace function public.is_school_user() returns boolean
language sql stable as $$ select coalesce(auth.jwt()->>'email','') like '%@yourschool.edu.ph' $$;

create table profiles (
  id uuid primary key references auth.users on delete cascade,
  email text, full_name text,
  role text not null default 'documentarian'
    check (role in ('pm','programmer','documentarian','analyst')));

create table revisions (
  id bigint generated always as identity primary key,
  part text not null check (part in ('system','manuscript')),
  panelist text not null,
  title text not null,
  chapters int[] not null default '{}',
  section_note text,
  assignee uuid references profiles(id),
  start_date date not null default current_date,
  deadline date not null default '2026-12-01',
  status text not null default 'todo' check (status in ('todo','doing','done')),
  created_at timestamptz default now());

create table chapter_docs (chapter int primary key check (chapter between 1 and 5), doc_url text);
insert into chapter_docs(chapter) select generate_series(1,5);

alter table profiles enable row level security;
alter table revisions enable row level security;
alter table chapter_docs enable row level security;
create policy "team" on profiles for all using (is_school_user()) with check (is_school_user());
create policy "team" on revisions for all using (is_school_user()) with check (is_school_user());
create policy "team" on chapter_docs for all using (is_school_user()) with check (is_school_user());

-- Added: notes per revision
create table revision_comments (
  id bigint generated always as identity primary key,
  revision_id bigint not null references revisions(id) on delete cascade,
  author uuid references profiles(id),
  body text not null,
  created_at timestamptz default now());
alter table revision_comments enable row level security;
create policy "team" on revision_comments for all using (is_school_user()) with check (is_school_user());