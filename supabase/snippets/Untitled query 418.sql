select d.title, count(p.id) as pages
from documents d left join document_pages p on p.doc_id = d.id
group by d.title;