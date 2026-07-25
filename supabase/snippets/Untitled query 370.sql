select title, page_number, length(text) as chars, ocr_used
from document_pages p join documents d on d.id=p.doc_id
where d.title like 'I-360%';