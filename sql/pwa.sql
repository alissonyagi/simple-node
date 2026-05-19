create table if not exists pwa_file_cache (
	id_file_cache integer primary key not null,
	tx_file text not null,
	tx_hash text not null,
	tx_status text not null default 'active',
	dt_creation text not null default current_timestamp
) strict;

create index if not exists ix_pwa_file_cache_1 on pwa_file_cache (tx_status);
create index if not exists ix_pwa_file_cache_2 on pwa_file_cache (tx_file, tx_hash);
