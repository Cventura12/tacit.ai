select d.title, p.page_number, left(p.text, 60) as text_start
from document_pages p join documents d on d.id = p.doc_id
where d.title like 'I-360%';