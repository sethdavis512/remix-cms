drop index entries_type_locale_status_idx;

alter table entries drop column locale;

alter table content_types drop column localized;

drop table locales;
