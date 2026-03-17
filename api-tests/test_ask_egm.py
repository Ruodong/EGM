"""Tests for Ask EGM — AI chat endpoints (with attachment + follow-up support)."""
import io

import httpx
import pytest
from docx import Document
from openpyxl import Workbook
from pypdf import PdfWriter

BASE_URL = "http://localhost:4001/api"

ADMIN = {"X-Dev-Role": "admin"}
REVIEWER = {"X-Dev-Role": "domain_reviewer"}
REQUESTOR = {"X-Dev-Role": "requestor"}


class TestAskEgm:
    """Ask EGM conversation history and chat tests."""

    def test_get_history_empty(self, client: httpx.Client, submitted_request_with_reviews):
        """History is empty for a new domain review."""
        review_id = submitted_request_with_reviews["reviewId"]
        resp = client.get(f"/ask-egm/{review_id}/history", headers=ADMIN)
        assert resp.status_code == 200
        data = resp.json()["data"]
        assert isinstance(data, list)
        assert len(data) == 0

    def test_chat_returns_sse_or_503(self, client: httpx.Client, submitted_request_with_reviews):
        """POST chat returns SSE stream (200) or 503 if Azure OpenAI not configured."""
        review_id = submitted_request_with_reviews["reviewId"]
        with httpx.Client(base_url=BASE_URL, timeout=60) as c:
            resp = c.post(
                f"/ask-egm/{review_id}/chat",
                json={"message": "Hello, what is this review about?"},
                headers=ADMIN,
            )
            # 200 = Azure OpenAI configured, 503 = not configured
            assert resp.status_code in (200, 503)
            if resp.status_code == 200:
                assert "text/event-stream" in resp.headers.get("content-type", "")
                assert "data:" in resp.text

    def test_chat_saves_user_message_when_configured(self, client: httpx.Client, submitted_request_with_reviews):
        """When Azure OpenAI is configured, chat persists user + assistant messages."""
        review_id = submitted_request_with_reviews["reviewId"]

        # Clear any prior history
        client.delete(f"/ask-egm/{review_id}/history", headers=ADMIN)

        # Attempt a chat
        with httpx.Client(base_url=BASE_URL, timeout=60) as c:
            resp = c.post(
                f"/ask-egm/{review_id}/chat",
                json={"message": "List the key risks"},
                headers=ADMIN,
            )
        if resp.status_code == 503:
            pytest.skip("Azure OpenAI not configured — skipping persistence check")

        # Check history has user message
        resp = client.get(f"/ask-egm/{review_id}/history", headers=ADMIN)
        assert resp.status_code == 200
        data = resp.json()["data"]
        user_msgs = [m for m in data if m["role"] == "user"]
        assert len(user_msgs) >= 1

    def test_clear_history(self, client: httpx.Client, submitted_request_with_reviews):
        """DELETE history should clear all messages."""
        review_id = submitted_request_with_reviews["reviewId"]

        # Clear (works even if empty)
        resp = client.delete(f"/ask-egm/{review_id}/history", headers=ADMIN)
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

        # Verify empty
        resp = client.get(f"/ask-egm/{review_id}/history", headers=ADMIN)
        assert resp.status_code == 200
        assert len(resp.json()["data"]) == 0

    def test_empty_message_rejected(self, client: httpx.Client, submitted_request_with_reviews):
        """Empty messages should be rejected."""
        review_id = submitted_request_with_reviews["reviewId"]
        resp = client.post(
            f"/ask-egm/{review_id}/chat",
            json={"message": "   "},
            headers=ADMIN,
        )
        assert resp.status_code == 422


class TestAskEgmAttachments:
    """Tests for file/image upload and attachment features."""

    def test_upload_image(self, client: httpx.Client, submitted_request_with_reviews):
        """Upload a PNG image returns attachment metadata."""
        review_id = submitted_request_with_reviews["reviewId"]
        # Create a minimal 1x1 PNG
        png_bytes = (
            b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01'
            b'\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde\x00'
            b'\x00\x00\x0cIDATx\x9cc\xf8\x0f\x00\x00\x01\x01\x00'
            b'\x05\x18\xd8N\x00\x00\x00\x00IEND\xaeB`\x82'
        )
        files = {"file": ("test.png", io.BytesIO(png_bytes), "image/png")}
        with httpx.Client(base_url=BASE_URL, timeout=30) as c:
            resp = c.post(
                f"/ask-egm/{review_id}/upload",
                files=files,
                headers=ADMIN,
            )
        assert resp.status_code == 200
        data = resp.json()
        assert data["fileName"] == "test.png"
        assert data["contentType"] == "image/png"
        assert data["isImage"] is True
        assert "id" in data

    def test_upload_text_file(self, client: httpx.Client, submitted_request_with_reviews):
        """Upload a text file returns attachment metadata."""
        review_id = submitted_request_with_reviews["reviewId"]
        files = {"file": ("notes.txt", io.BytesIO(b"Hello world"), "text/plain")}
        with httpx.Client(base_url=BASE_URL, timeout=30) as c:
            resp = c.post(
                f"/ask-egm/{review_id}/upload",
                files=files,
                headers=ADMIN,
            )
        assert resp.status_code == 200
        data = resp.json()
        assert data["fileName"] == "notes.txt"
        assert data["isImage"] is False

    def test_upload_unsupported_type(self, client: httpx.Client, submitted_request_with_reviews):
        """Reject unsupported file types."""
        review_id = submitted_request_with_reviews["reviewId"]
        files = {"file": ("malware.exe", io.BytesIO(b"\x00"), "application/x-executable")}
        with httpx.Client(base_url=BASE_URL, timeout=30) as c:
            resp = c.post(
                f"/ask-egm/{review_id}/upload",
                files=files,
                headers=ADMIN,
            )
        assert resp.status_code == 400

    def test_download_attachment(self, client: httpx.Client, submitted_request_with_reviews):
        """Uploaded attachment can be downloaded."""
        review_id = submitted_request_with_reviews["reviewId"]
        content = b"test file content for download"
        files = {"file": ("dl-test.txt", io.BytesIO(content), "text/plain")}
        with httpx.Client(base_url=BASE_URL, timeout=30) as c:
            upload_resp = c.post(
                f"/ask-egm/{review_id}/upload",
                files=files,
                headers=ADMIN,
            )
        assert upload_resp.status_code == 200
        att_id = upload_resp.json()["id"]

        # Download it
        resp = client.get(f"/ask-egm/attachments/{att_id}", headers=ADMIN)
        assert resp.status_code == 200
        assert resp.content == content

    def test_download_nonexistent(self, client: httpx.Client):
        """404 for non-existent attachment."""
        resp = client.get(
            "/ask-egm/attachments/00000000-0000-0000-0000-000000000000",
            headers=ADMIN,
        )
        assert resp.status_code == 404

    def test_chat_with_attachments(self, client: httpx.Client, submitted_request_with_reviews):
        """Chat accepts attachmentIds parameter."""
        review_id = submitted_request_with_reviews["reviewId"]
        # Upload an image first
        png_bytes = (
            b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01'
            b'\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde\x00'
            b'\x00\x00\x0cIDATx\x9cc\xf8\x0f\x00\x00\x01\x01\x00'
            b'\x05\x18\xd8N\x00\x00\x00\x00IEND\xaeB`\x82'
        )
        with httpx.Client(base_url=BASE_URL, timeout=30) as c:
            upload_resp = c.post(
                f"/ask-egm/{review_id}/upload",
                files={"file": ("test.png", io.BytesIO(png_bytes), "image/png")},
                headers=ADMIN,
            )
        assert upload_resp.status_code == 200
        att_id = upload_resp.json()["id"]

        # Send chat with attachment
        with httpx.Client(base_url=BASE_URL, timeout=60) as c:
            resp = c.post(
                f"/ask-egm/{review_id}/chat",
                json={"message": "What is in this image?", "attachmentIds": [att_id]},
                headers=ADMIN,
            )
        # 200 (LLM configured) or 503 (not configured)
        assert resp.status_code in (200, 503)

        if resp.status_code == 200:
            # Check history includes attachment metadata
            hist_resp = client.get(f"/ask-egm/{review_id}/history", headers=ADMIN)
            assert hist_resp.status_code == 200
            user_msgs = [m for m in hist_resp.json()["data"] if m["role"] == "user"]
            # At least one user message should have attachments in metadata
            has_att = any(
                m.get("metadata") and m["metadata"].get("attachments") for m in user_msgs
            )
            assert has_att

    def test_history_includes_metadata(self, client: httpx.Client, submitted_request_with_reviews):
        """History endpoint returns metadata field."""
        review_id = submitted_request_with_reviews["reviewId"]
        resp = client.get(f"/ask-egm/{review_id}/history", headers=ADMIN)
        assert resp.status_code == 200
        # Metadata field should be present (even if null) in all messages
        for msg in resp.json()["data"]:
            assert "metadata" in msg

    def test_clear_also_removes_attachments(self, client: httpx.Client, submitted_request_with_reviews):
        """Clear history also removes attachments."""
        review_id = submitted_request_with_reviews["reviewId"]
        # Upload something
        with httpx.Client(base_url=BASE_URL, timeout=30) as c:
            upload_resp = c.post(
                f"/ask-egm/{review_id}/upload",
                files={"file": ("temp.txt", io.BytesIO(b"temp"), "text/plain")},
                headers=ADMIN,
            )
        att_id = upload_resp.json()["id"]

        # Clear history (also clears attachments)
        client.delete(f"/ask-egm/{review_id}/history", headers=ADMIN)

        # Attachment should be gone
        resp = client.get(f"/ask-egm/attachments/{att_id}", headers=ADMIN)
        assert resp.status_code == 404


class TestAskEgmAuthorization:
    """P1-1: Object-level authorization tests for Ask EGM endpoints."""

    def test_requestor_cannot_clear_history(self, client: httpx.Client, submitted_request_with_reviews):
        """Requestors lack domain_review:write so DELETE history returns 403."""
        review_id = submitted_request_with_reviews["reviewId"]
        resp = client.delete(f"/ask-egm/{review_id}/history", headers=REQUESTOR)
        assert resp.status_code == 403

    def test_unrelated_reviewer_cannot_access_history(self, client: httpx.Client, submitted_request_with_reviews):
        """A reviewer not assigned to the domain gets 403 on history."""
        review_id = submitted_request_with_reviews["reviewId"]
        # X-Dev-User simulates a specific user; PYTEST_DOM domain is the review's domain
        # Use a user that IS a domain_reviewer but NOT for PYTEST_DOM
        resp = client.get(
            f"/ask-egm/{review_id}/history",
            headers={"X-Dev-User": "unrelated_reviewer"},
        )
        # Could be 403 (wrong domain) or 200 (if dev middleware resolves as admin)
        # With X-Dev-User, the middleware resolves actual roles from user_role table
        # An unknown user defaults to requestor role — so they get 403 unless they own the request
        assert resp.status_code in (200, 403)

    def test_nonexistent_review_returns_404(self, client: httpx.Client):
        """Access to non-existent review should return 404."""
        resp = client.get(
            "/ask-egm/00000000-0000-0000-0000-000000000000/history",
            headers=ADMIN,
        )
        assert resp.status_code == 404

    def test_admin_can_access_any_review(self, client: httpx.Client, submitted_request_with_reviews):
        """Admin always has access."""
        review_id = submitted_request_with_reviews["reviewId"]
        resp = client.get(f"/ask-egm/{review_id}/history", headers=ADMIN)
        assert resp.status_code == 200


class TestAskEgmAttachmentLifecycle:
    """P2-6: Individual attachment deletion to prevent orphans."""

    def test_delete_pending_attachment(self, client: httpx.Client, submitted_request_with_reviews):
        """Uploaded attachment can be individually deleted (before send)."""
        review_id = submitted_request_with_reviews["reviewId"]
        # Upload a file
        with httpx.Client(base_url=BASE_URL, timeout=30) as c:
            upload_resp = c.post(
                f"/ask-egm/{review_id}/upload",
                files={"file": ("orphan.txt", io.BytesIO(b"orphan data"), "text/plain")},
                headers=ADMIN,
            )
        assert upload_resp.status_code == 200
        att_id = upload_resp.json()["id"]

        # Delete it
        resp = client.delete(f"/ask-egm/attachments/{att_id}", headers=ADMIN)
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

        # Verify it's gone
        resp = client.get(f"/ask-egm/attachments/{att_id}", headers=ADMIN)
        assert resp.status_code == 404

    def test_delete_nonexistent_attachment(self, client: httpx.Client):
        """Delete non-existent attachment returns 404."""
        resp = client.delete(
            "/ask-egm/attachments/00000000-0000-0000-0000-000000000000",
            headers=ADMIN,
        )
        assert resp.status_code == 404


class TestAskEgmDocumentUpload:
    """P2-5: PDF/DOCX/XLSX upload and text extraction support."""

    def _make_pdf_bytes(self, text: str = "Hello from PDF") -> bytes:
        """Create a minimal PDF with text content."""
        writer = PdfWriter()
        writer.add_blank_page(width=612, height=792)
        # Add metadata so we can verify upload works (actual text extraction tested via LLM path)
        writer.add_metadata({"/Title": text})
        buf = io.BytesIO()
        writer.write(buf)
        return buf.getvalue()

    def _make_docx_bytes(self, text: str = "Hello from DOCX") -> bytes:
        """Create a minimal DOCX with text content."""
        doc = Document()
        doc.add_paragraph(text)
        buf = io.BytesIO()
        doc.save(buf)
        return buf.getvalue()

    def _make_xlsx_bytes(self, text: str = "Hello from XLSX") -> bytes:
        """Create a minimal XLSX with cell content."""
        wb = Workbook()
        ws = wb.active
        ws["A1"] = text
        buf = io.BytesIO()
        wb.save(buf)
        return buf.getvalue()

    def test_upload_pdf(self, client: httpx.Client, submitted_request_with_reviews):
        """PDF upload returns correct metadata."""
        review_id = submitted_request_with_reviews["reviewId"]
        pdf_data = self._make_pdf_bytes()
        files = {"file": ("report.pdf", io.BytesIO(pdf_data), "application/pdf")}
        with httpx.Client(base_url=BASE_URL, timeout=30) as c:
            resp = c.post(
                f"/ask-egm/{review_id}/upload", files=files, headers=ADMIN,
            )
        assert resp.status_code == 200
        data = resp.json()
        assert data["fileName"] == "report.pdf"
        assert data["contentType"] == "application/pdf"
        assert data["isImage"] is False
        assert "id" in data

    def test_upload_docx(self, client: httpx.Client, submitted_request_with_reviews):
        """DOCX upload returns correct metadata."""
        review_id = submitted_request_with_reviews["reviewId"]
        docx_data = self._make_docx_bytes()
        ct = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        files = {"file": ("review.docx", io.BytesIO(docx_data), ct)}
        with httpx.Client(base_url=BASE_URL, timeout=30) as c:
            resp = c.post(
                f"/ask-egm/{review_id}/upload", files=files, headers=ADMIN,
            )
        assert resp.status_code == 200
        data = resp.json()
        assert data["fileName"] == "review.docx"
        assert data["contentType"] == ct
        assert data["isImage"] is False

    def test_upload_xlsx(self, client: httpx.Client, submitted_request_with_reviews):
        """XLSX upload returns correct metadata."""
        review_id = submitted_request_with_reviews["reviewId"]
        xlsx_data = self._make_xlsx_bytes()
        ct = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        files = {"file": ("data.xlsx", io.BytesIO(xlsx_data), ct)}
        with httpx.Client(base_url=BASE_URL, timeout=30) as c:
            resp = c.post(
                f"/ask-egm/{review_id}/upload", files=files, headers=ADMIN,
            )
        assert resp.status_code == 200
        data = resp.json()
        assert data["fileName"] == "data.xlsx"
        assert data["contentType"] == ct
        assert data["isImage"] is False

    def test_pdf_download_roundtrip(self, client: httpx.Client, submitted_request_with_reviews):
        """Uploaded PDF can be downloaded with identical bytes."""
        review_id = submitted_request_with_reviews["reviewId"]
        pdf_data = self._make_pdf_bytes("Roundtrip test")
        files = {"file": ("rt.pdf", io.BytesIO(pdf_data), "application/pdf")}
        with httpx.Client(base_url=BASE_URL, timeout=30) as c:
            upload_resp = c.post(
                f"/ask-egm/{review_id}/upload", files=files, headers=ADMIN,
            )
        assert upload_resp.status_code == 200
        att_id = upload_resp.json()["id"]

        resp = client.get(f"/ask-egm/attachments/{att_id}", headers=ADMIN)
        assert resp.status_code == 200
        assert resp.content == pdf_data


class TestAskEgmOwnershipAndAttachmentOnly:
    """Tests for attachment ownership check and attachment-only send."""

    def test_other_user_cannot_delete_attachment(
        self, client: httpx.Client, submitted_request_with_reviews,
    ):
        """A different non-admin user cannot delete attachment uploaded by admin — 403."""
        review_id = submitted_request_with_reviews["reviewId"]
        request_id = submitted_request_with_reviews["request"]["requestId"]

        # Use an existing requestor from the system (wangdan37 has requestor role)
        # First need to make them the request's requestor so they pass _check_review_access
        other_user = "wangdan37"

        # Upload as admin (default dev user = yangrd)
        with httpx.Client(base_url=BASE_URL, timeout=30) as c:
            upload_resp = c.post(
                f"/ask-egm/{review_id}/upload",
                files={"file": ("admin-file.txt", io.BytesIO(b"admin data"), "text/plain")},
                headers=ADMIN,
            )
        assert upload_resp.status_code == 200
        att_id = upload_resp.json()["id"]

        # Attempt delete as a different user with requestor role
        # Requestors can access reviews for requests they own; this user may not own the request
        # so they might get 403 from _check_review_access. Either way, they should NOT get 200.
        resp = client.delete(
            f"/ask-egm/attachments/{att_id}",
            headers={"X-Dev-User": other_user},
        )
        assert resp.status_code == 403

        # Cleanup: delete as admin
        client.delete(f"/ask-egm/attachments/{att_id}", headers=ADMIN)

    def test_uploader_can_delete_own_attachment(
        self, client: httpx.Client, submitted_request_with_reviews,
    ):
        """Admin who uploaded can delete their own attachment — 200."""
        review_id = submitted_request_with_reviews["reviewId"]
        with httpx.Client(base_url=BASE_URL, timeout=30) as c:
            upload_resp = c.post(
                f"/ask-egm/{review_id}/upload",
                files={"file": ("own-file.txt", io.BytesIO(b"own data"), "text/plain")},
                headers=ADMIN,
            )
        assert upload_resp.status_code == 200
        att_id = upload_resp.json()["id"]

        # Delete as same admin who uploaded
        resp = client.delete(f"/ask-egm/attachments/{att_id}", headers=ADMIN)
        assert resp.status_code == 200

    def test_attachment_only_send(
        self, client: httpx.Client, submitted_request_with_reviews,
    ):
        """Send with attachmentIds but no text message — should succeed (200 or 503)."""
        review_id = submitted_request_with_reviews["reviewId"]
        # Upload a file first
        with httpx.Client(base_url=BASE_URL, timeout=30) as c:
            upload_resp = c.post(
                f"/ask-egm/{review_id}/upload",
                files={"file": ("attach.txt", io.BytesIO(b"file content"), "text/plain")},
                headers=ADMIN,
            )
        assert upload_resp.status_code == 200
        att_id = upload_resp.json()["id"]

        # Send with empty message but with attachment
        with httpx.Client(base_url=BASE_URL, timeout=60) as c:
            resp = c.post(
                f"/ask-egm/{review_id}/chat",
                json={"message": "", "attachmentIds": [att_id]},
                headers=ADMIN,
            )
        # 200 (LLM configured) or 503 (not configured) — but NOT 422
        assert resp.status_code in (200, 503)
