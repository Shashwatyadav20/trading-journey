-- Phase 8 / 8.1: Unified AI Command Center Conversation & Message Persistence
-- Strictly user-scoped via user_id (auth.users) and granular Row Level Security.

create table if not exists public.ai_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'New AI Research Session',
  last_intent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_ai_conversations_user_updated
  on public.ai_conversations (user_id, updated_at desc);

create table if not exists public.ai_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.ai_conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  structured_response jsonb,
  agent_executions jsonb,
  token_usage jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_ai_messages_conv_created
  on public.ai_messages (conversation_id, created_at asc);

create index if not exists idx_ai_messages_user_conv_created
  on public.ai_messages (user_id, conversation_id, created_at asc);

alter table public.ai_conversations enable row level security;
alter table public.ai_messages enable row level security;

-- Drop legacy combined policies if present
drop policy if exists "ai_conversations_owner_all" on public.ai_conversations;
drop policy if exists "ai_messages_owner_all" on public.ai_messages;

-- Explicit SELECT / INSERT / UPDATE / DELETE policies for ai_conversations
drop policy if exists "ai_conversations_select_own" on public.ai_conversations;
create policy "ai_conversations_select_own"
  on public.ai_conversations
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "ai_conversations_insert_own" on public.ai_conversations;
create policy "ai_conversations_insert_own"
  on public.ai_conversations
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "ai_conversations_update_own" on public.ai_conversations;
create policy "ai_conversations_update_own"
  on public.ai_conversations
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "ai_conversations_delete_own" on public.ai_conversations;
create policy "ai_conversations_delete_own"
  on public.ai_conversations
  for delete
  to authenticated
  using (auth.uid() = user_id);

-- Explicit SELECT / INSERT / UPDATE / DELETE policies for ai_messages
-- Enforces both direct user_id match and ownership through parent ai_conversations.
drop policy if exists "ai_messages_select_own" on public.ai_messages;
create policy "ai_messages_select_own"
  on public.ai_messages
  for select
  to authenticated
  using (
    auth.uid() = user_id
    and exists (
      select 1
      from public.ai_conversations c
      where c.id = ai_messages.conversation_id
        and c.user_id = auth.uid()
    )
  );

drop policy if exists "ai_messages_insert_own" on public.ai_messages;
create policy "ai_messages_insert_own"
  on public.ai_messages
  for insert
  to authenticated
  with check (
    auth.uid() = user_id
    and exists (
      select 1
      from public.ai_conversations c
      where c.id = ai_messages.conversation_id
        and c.user_id = auth.uid()
    )
  );

drop policy if exists "ai_messages_update_own" on public.ai_messages;
create policy "ai_messages_update_own"
  on public.ai_messages
  for update
  to authenticated
  using (
    auth.uid() = user_id
    and exists (
      select 1
      from public.ai_conversations c
      where c.id = ai_messages.conversation_id
        and c.user_id = auth.uid()
    )
  )
  with check (
    auth.uid() = user_id
    and exists (
      select 1
      from public.ai_conversations c
      where c.id = ai_messages.conversation_id
        and c.user_id = auth.uid()
    )
  );

drop policy if exists "ai_messages_delete_own" on public.ai_messages;
create policy "ai_messages_delete_own"
  on public.ai_messages
  for delete
  to authenticated
  using (
    auth.uid() = user_id
    and exists (
      select 1
      from public.ai_conversations c
      where c.id = ai_messages.conversation_id
        and c.user_id = auth.uid()
    )
  );
