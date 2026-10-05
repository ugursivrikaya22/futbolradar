-- Provider ids are unique within a source, independent of team names or kickoff.
-- Existing canonical ids (referenced by reports and indexed URLs) are preserved.
-- If legacy duplicates exist, this fails visibly rather than deleting records.
create unique index if not exists matches_provider_identity_unique
  on public.matches (source_id, provider_fixture_id)
  where provider_fixture_id is not null;
