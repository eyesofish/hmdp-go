package handler

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/amemiya02/hmdp-go/internal/model/dto"
	"github.com/gin-gonic/gin"
)

const acceptedID = 661639913812262913

type stubVoucherOrders struct {
	lookupErr error
}

func (stubVoucherOrders) SeckillVoucherV3(context.Context, uint64) *dto.Result {
	return dto.OkWithData(uint64(acceptedID))
}

func (s stubVoucherOrders) IsOrderConfirmed(_ context.Context, id int64) (bool, error) {
	return id == acceptedID, s.lookupErr
}

func TestVoucherOrderHTTP(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, tc := range []struct {
		name     string
		method   string
		url      string
		storeErr error
		status   int
		body     string
	}{
		{"accepted ID is text", "POST", "/seckill/10", nil, 200, `{"success":true,"data":"661639913812262913"}`},
		{"committed ID is text", "GET", "/661639913812262913/confirmation", nil, 200, `{"success":true,"data":{"confirmed":true,"orderId":"661639913812262913"}}`},
		{"unconfirmed", "GET", "/100/confirmation", nil, 200, `{"success":true,"data":{"confirmed":false}}`},
		{"database unavailable", "GET", "/100/confirmation", errors.New("database unavailable"), 500, `{"success":false,"errorMsg":"查询订单确认状态失败"}`},
		{"invalid ID", "GET", "/invalid/confirmation", nil, 400, `{"success":false,"errorMsg":"订单号格式错误"}`},
		{"zero ID", "GET", "/0/confirmation", nil, 400, `{"success":false,"errorMsg":"订单号格式错误"}`},
		{"ID exceeds signed bigint", "GET", "/9223372036854775808/confirmation", nil, 400, `{"success":false,"errorMsg":"订单号格式错误"}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			h := NewVoucherOrderHandler(stubVoucherOrders{lookupErr: tc.storeErr})
			router := gin.New()
			router.POST("/seckill/:id", h.SeckillVoucher)
			router.GET("/:id/confirmation", h.Confirmation)
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, httptest.NewRequest(tc.method, tc.url, nil))
			if rec.Code != tc.status || rec.Body.String() != tc.body {
				t.Fatalf("got %d %s, want %d %s", rec.Code, rec.Body, tc.status, tc.body)
			}
			if tc.method == http.MethodGet && rec.Header().Get("Cache-Control") != "no-store" {
				t.Error("confirmation response must disable caching")
			}
		})
	}
}
