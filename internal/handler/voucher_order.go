package handler

import (
	"context"
	"net/http"
	"strconv"

	"github.com/amemiya02/hmdp-go/internal/global"
	"github.com/amemiya02/hmdp-go/internal/model/dto"
	"github.com/gin-gonic/gin"
)

type voucherOrderService interface {
	SeckillVoucherV3(context.Context, uint64) *dto.Result
	IsOrderConfirmed(context.Context, int64) (bool, error)
}

type VoucherOrderHandler struct {
	service voucherOrderService
}

func NewVoucherOrderHandler(vos voucherOrderService) *VoucherOrderHandler {
	return &VoucherOrderHandler{
		service: vos,
	}
}

func (vo *VoucherOrderHandler) SeckillVoucher(c *gin.Context) {
	var req struct {
		ID uint64 `uri:"id"`
	}
	if err := c.ShouldBindUri(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	result := vo.service.SeckillVoucherV3(c, req.ID)
	if result.Success {
		orderID, ok := result.Data.(uint64)
		if !ok {
			c.JSON(http.StatusInternalServerError, dto.Fail("订单号格式错误"))
			return
		}
		result = dto.OkWithData(strconv.FormatUint(orderID, 10))
	}
	c.JSON(http.StatusOK, result)
}

func (vo *VoucherOrderHandler) Confirmation(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	id, err := strconv.ParseUint(c.Param("id"), 10, 63)
	if err != nil || id == 0 {
		c.JSON(http.StatusBadRequest, dto.Fail("订单号格式错误"))
		return
	}
	confirmed, err := vo.service.IsOrderConfirmed(c, int64(id))
	if err != nil {
		global.Logger.Error("查询订单确认状态失败", "order_id", id, "error", err)
		c.JSON(http.StatusInternalServerError, dto.Fail("查询订单确认状态失败"))
		return
	}
	data := gin.H{"confirmed": confirmed}
	if confirmed {
		data["orderId"] = strconv.FormatUint(id, 10)
	}
	c.JSON(http.StatusOK, dto.OkWithData(data))
}
