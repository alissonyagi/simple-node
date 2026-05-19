select
	id_file_cache,
	tx_file,
	tx_hash
from
	pwa_file_cache
where
	vr_status = 'active'
order by
	dt_creation
