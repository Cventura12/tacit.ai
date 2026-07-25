select d.title, p.page_number, p.ocr_used, length(p.text) as chars
from document_pages p join documents d on d.id = p.doc_id
order by d.created_at desc limit 6;