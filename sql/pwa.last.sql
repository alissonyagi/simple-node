with hash_ref as (
	select
		id_file_cache
	from
		pwa_file_cache
	where
		tx_file = '.'
		and tx_hash = $hash
	order by
		dt_creation
	limit 1
)
select
	tx_file,
	tx_hash,
	vr_status
from
	pwa_file_cache
where
	(((select count(*) from hash_ref) = 0) and vr_status = 'active')
	or (vr_status in ('active', 'removed') and id_file_cache > (select id_file_cache from hash_ref))
